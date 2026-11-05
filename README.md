# Мини-CRM «Объекты и задачи»

Постановщики ставят задачи по стройкам, исполнители выполняют их и отдают на проверку.
Правила доступа и статусов находятся в базе, поэтому работают и при запросах в обход интерфейса.

Стек: React, TypeScript, Vite, Supabase (Postgres, Auth, RLS).

## Запуск локально

Нужны Node.js и Docker.

```bash
npm install
npx supabase start          # выведет адрес API и ключи
cp .env.example .env        # впишите адрес и anon-ключ
npm run dev
```

Тестовые данные:

```bash
SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... SEED_PASSWORD=... npm run seed
```

Создаются один постановщик, два исполнителя, три объекта и задачи во всех статусах.

## Проверка безопасности

Тесты обращаются к API напрямую от имени разных пользователей:

```bash
SUPABASE_URL=... SUPABASE_ANON_KEY=... SUPABASE_SERVICE_ROLE_KEY=... npm run test:security
```

Проверка уже развёрнутого проекта, она не меняет данные (нужны `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SEED_PASSWORD`):

```bash
npm run verify:deployed
```

## Развёртывание

1. Создайте проект Supabase и в Authentication отключите регистрацию новых пользователей.
2. Примените миграции: `npx supabase link --project-ref <ref>`, затем `npx supabase db push`.
3. Запустите `npm run seed` с ключами проекта.
4. Разверните фронтенд на Vercel с переменными `VITE_SUPABASE_URL` и `VITE_SUPABASE_ANON_KEY`.

Ключ `service_role` используется только в локальном запуске сида. Во фронтенд и репозиторий он не попадает.

## Как устроена защита

- Таблицы закрыты для всех, затем открыты только нужные права и политики RLS.
- Колонку `status` нельзя менять напрямую: на неё нет прав. Статус меняет только функция `change_task_status`, она проверяет переход, роль и комментарий.
- `task_status_history` доступна только для чтения. Записи создают функции базы, а триггер запрещает изменять и удалять строки.
- Роль хранится в `profiles` и задаётся администратором через `app_metadata`, пользователь сам её не меняет.

## Решения и допущения

Подробно: [docs/decisions.md](docs/decisions.md).
