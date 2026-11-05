-- Мини-CRM «Объекты и задачи».
-- Правила доступа живут в базе: интерфейс только показывает то, что база и так разрешает.

create type public.user_role as enum ('manager', 'executor');
create type public.task_status as enum ('new', 'in_progress', 'review', 'accepted', 'rework');

-- ---------------------------------------------------------------------------
-- Таблицы
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null,
  role public.user_role not null default 'executor'
);

create table public.objects (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  address text not null check (length(trim(address)) > 0),
  created_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  description text not null default '',
  -- Объект с задачами удалить нельзя: так задачи не пропадут незаметно.
  object_id uuid not null references public.objects (id) on delete restrict,
  assignee_id uuid not null references public.profiles (id) on delete restrict,
  status public.task_status not null default 'new',
  author_id uuid not null default auth.uid() references public.profiles (id) on delete restrict,
  created_at timestamptz not null default now()
);

create index tasks_object_id_idx on public.tasks (object_id);
create index tasks_assignee_id_idx on public.tasks (assignee_id);

-- Намеренно без внешнего ключа на tasks: журнал переживает удаление задачи,
-- иначе удаление задачи стало бы способом удалить её историю.
create table public.task_status_history (
  id bigint generated always as identity primary key,
  task_id uuid not null,
  from_status public.task_status,
  to_status public.task_status not null,
  changed_by uuid not null references public.profiles (id) on delete restrict,
  comment text,
  created_at timestamptz not null default now()
);

create index task_status_history_task_id_idx on public.task_status_history (task_id, created_at);

-- ---------------------------------------------------------------------------
-- Профиль создаётся вместе с пользователем. Роль берём из app_metadata:
-- её задаёт только администратор, сам пользователь изменить её не может.
-- ---------------------------------------------------------------------------

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_app_meta_data ->> 'full_name', new.email),
    coalesce((new.raw_app_meta_data ->> 'role')::public.user_role, 'executor')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Supabase Auth может записать app_metadata уже после создания пользователя,
-- а администратор может поменять роль позже. Профиль держим в соответствии с ними.
create function public.handle_user_metadata_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set
    full_name = coalesce(new.raw_app_meta_data ->> 'full_name', full_name),
    role = coalesce((new.raw_app_meta_data ->> 'role')::public.user_role, role)
  where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_metadata_changed
  after update of raw_app_meta_data on auth.users
  for each row
  when (old.raw_app_meta_data is distinct from new.raw_app_meta_data)
  execute function public.handle_user_metadata_change();

-- ---------------------------------------------------------------------------
-- Проверка роли для политик
-- ---------------------------------------------------------------------------

create function public.is_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'manager'
  );
$$;

-- ---------------------------------------------------------------------------
-- Целостность задач
-- ---------------------------------------------------------------------------

create function public.check_task_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.profiles where id = new.assignee_id and role = 'executor'
  ) then
    raise exception 'Исполнителем можно назначить только пользователя с ролью исполнителя'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger tasks_check_assignee
  before insert or update of assignee_id on public.tasks
  for each row execute function public.check_task_assignee();

-- Первая запись истории: «— → Новая».
create function public.log_task_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.task_status_history (task_id, from_status, to_status, changed_by)
  values (new.id, null, new.status, new.author_id);
  return new;
end;
$$;

create trigger tasks_log_created
  after insert on public.tasks
  for each row execute function public.log_task_created();

-- Единственный способ сменить статус. Прямой UPDATE колонки status запрещён правами ниже.
create function public.change_task_status(
  p_task_id uuid,
  p_to_status public.task_status,
  p_comment text default null
)
returns public.tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task public.tasks;
  v_uid uuid := auth.uid();
  v_is_manager boolean := public.is_manager();
  v_comment text := nullif(trim(p_comment), '');
  v_from public.task_status;
begin
  -- Блокировка строки: два одновременных запроса не проведут задачу двумя переходами.
  select * into v_task from public.tasks where id = p_task_id for update;

  -- Одинаковый ответ для «нет задачи» и «чужая задача»: не раскрываем, что задача существует.
  if not found or not (v_is_manager or v_task.assignee_id = v_uid) then
    raise exception 'Задача не найдена' using errcode = 'P0002';
  end if;

  if not (
    (v_task.status = 'new' and p_to_status = 'in_progress' and v_task.assignee_id = v_uid)
    or (v_task.status = 'in_progress' and p_to_status = 'review' and v_task.assignee_id = v_uid)
    or (v_task.status = 'review' and p_to_status = 'accepted' and v_is_manager)
    or (v_task.status = 'review' and p_to_status = 'rework' and v_is_manager)
    or (v_task.status = 'rework' and p_to_status = 'in_progress' and v_task.assignee_id = v_uid)
  ) then
    raise exception 'Переход статуса запрещён' using errcode = '42501';
  end if;

  if p_to_status = 'rework' and v_comment is null then
    raise exception 'Для возврата на доработку нужен комментарий' using errcode = '23514';
  end if;

  v_from := v_task.status;

  update public.tasks set status = p_to_status where id = p_task_id
  returning * into v_task;

  insert into public.task_status_history (task_id, from_status, to_status, changed_by, comment)
  values (p_task_id, v_from, p_to_status, v_uid, v_comment);

  return v_task;
end;
$$;

-- Историю нельзя переписать даже привилегированной ролью, случайно или намеренно.
create function public.forbid_history_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'История статусов неизменяема' using errcode = '42501';
end;
$$;

create trigger task_status_history_immutable
  before update or delete on public.task_status_history
  for each row execute function public.forbid_history_change();

create trigger task_status_history_no_truncate
  before truncate on public.task_status_history
  for each statement execute function public.forbid_history_change();

-- ---------------------------------------------------------------------------
-- Права: сначала закрываем всё, затем открываем только нужное
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated, public;
revoke all on all sequences in schema public from anon, authenticated, public;
revoke execute on all functions in schema public from anon, authenticated, public;

grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.objects to authenticated;

-- Статус, автора и дату создания клиент задать не может: для них нет прав на колонки.
grant select, delete on public.tasks to authenticated;
grant insert (title, description, object_id, assignee_id) on public.tasks to authenticated;
grant update (title, description, object_id, assignee_id) on public.tasks to authenticated;

-- История: только чтение. Запись идёт из функций с правами владельца.
grant select on public.task_status_history to authenticated;

grant execute on function public.is_manager() to authenticated;
grant execute on function public.change_task_status(uuid, public.task_status, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.objects enable row level security;
alter table public.tasks enable row level security;
alter table public.task_status_history enable row level security;

-- Имена коллег нужны в истории и при назначении исполнителя.
create policy "profiles: чтение для сотрудников"
  on public.profiles for select to authenticated
  using (true);

create policy "objects: постановщик видит все, исполнитель только свои"
  on public.objects for select to authenticated
  using (
    public.is_manager()
    or exists (
      select 1 from public.tasks t
      where t.object_id = objects.id and t.assignee_id = auth.uid()
    )
  );

create policy "objects: создаёт постановщик"
  on public.objects for insert to authenticated
  with check (public.is_manager());

create policy "objects: меняет постановщик"
  on public.objects for update to authenticated
  using (public.is_manager())
  with check (public.is_manager());

create policy "objects: удаляет постановщик"
  on public.objects for delete to authenticated
  using (public.is_manager());

create policy "tasks: постановщик видит все, исполнитель только свои"
  on public.tasks for select to authenticated
  using (public.is_manager() or assignee_id = auth.uid());

create policy "tasks: создаёт постановщик"
  on public.tasks for insert to authenticated
  with check (public.is_manager() and author_id = auth.uid());

create policy "tasks: меняет постановщик"
  on public.tasks for update to authenticated
  using (public.is_manager())
  with check (public.is_manager());

create policy "tasks: удаляет постановщик"
  on public.tasks for delete to authenticated
  using (public.is_manager());

create policy "history: постановщик видит всю, исполнитель по своим задачам"
  on public.task_status_history for select to authenticated
  using (
    public.is_manager()
    or exists (
      select 1 from public.tasks t
      where t.id = task_status_history.task_id and t.assignee_id = auth.uid()
    )
  );
