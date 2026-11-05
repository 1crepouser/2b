// Проверяем правила напрямую через API Supabase, в обход интерфейса.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

const url = process.env.SUPABASE_URL!;
const anonKey = process.env.SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const password = "test-password-only-for-local-db";
const suffix = Date.now();

const newClient = (key = anonKey) => createClient(url, key, { auth: { persistSession: false } });
const admin = newClient(serviceKey);

async function makeUser(name: string, role: string): Promise<{ client: SupabaseClient; id: string }> {
  const email = `${name}-${suffix}@example.test`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { role, full_name: name },
  });
  if (error) throw error;
  const client = newClient();
  const signIn = await client.auth.signInWithPassword({ email, password });
  if (signIn.error) throw signIn.error;
  return { client, id: data.user.id };
}

let manager: Awaited<ReturnType<typeof makeUser>>;
let ivan: Awaited<ReturnType<typeof makeUser>>;
let petr: Awaited<ReturnType<typeof makeUser>>;
let objectId: string;
let otherObjectId: string;

async function createTask(assigneeId = ivan.id, object = objectId) {
  const { data, error } = await manager.client
    .from("tasks")
    .insert({ title: "Задача", description: "", object_id: object, assignee_id: assigneeId })
    .select()
    .single();
  if (error) throw error;
  return data.id as string;
}
const move = (client: SupabaseClient, id: string, status: string, comment?: string) =>
  client.rpc("change_task_status", { p_task_id: id, p_to_status: status, p_comment: comment ?? null });
const statusOf = async (id: string) =>
  (await manager.client.from("tasks").select("status").eq("id", id).single()).data?.status;

beforeAll(async () => {
  manager = await makeUser("manager", "manager");
  ivan = await makeUser("ivan", "executor");
  petr = await makeUser("petr", "executor");
  const { data, error } = await manager.client
    .from("objects")
    .insert([
      { name: "Объект Ивана", address: "адрес 1" },
      { name: "Объект Петра", address: "адрес 2" },
    ])
    .select();
  if (error) throw error;
  objectId = data[0].id;
  otherObjectId = data[1].id;
});

describe("анонимный доступ", () => {
  it("без входа данные недоступны", async () => {
    const anon = newClient();
    for (const table of ["tasks", "objects", "profiles", "task_status_history"]) {
      const { data, error } = await anon.from(table).select("*");
      expect(error ?? data).toBeTruthy();
      expect(data ?? []).toHaveLength(0);
    }
  });

  it("открытая регистрация отключена", async () => {
    const { data, error } = await newClient().auth.signUp({
      email: `stranger-${suffix}@example.test`,
      password,
    });
    expect(error).toBeTruthy();
    expect(data.user).toBeNull();
  });
});

describe("видимость", () => {
  it("исполнитель видит только свои задачи и объекты", async () => {
    const mine = await createTask(ivan.id, objectId);
    const foreign = await createTask(petr.id, otherObjectId);

    const tasks = (await ivan.client.from("tasks").select("id")).data!.map((t) => t.id);
    expect(tasks).toContain(mine);
    expect(tasks).not.toContain(foreign);

    const objects = (await ivan.client.from("objects").select("id")).data!.map((o) => o.id);
    expect(objects).toContain(objectId);
    expect(objects).not.toContain(otherObjectId);

    const history = await ivan.client.from("task_status_history").select("id").eq("task_id", foreign);
    expect(history.data).toHaveLength(0);
  });

  it("постановщик видит всё", async () => {
    const foreign = await createTask(petr.id, otherObjectId);
    const { data } = await manager.client.from("tasks").select("id").eq("id", foreign);
    expect(data).toHaveLength(1);
  });
});

describe("изменение данных исполнителем", () => {
  it("не может создать, изменить или удалить объекты и задачи", async () => {
    const id = await createTask();
    const insertTask = await ivan.client
      .from("tasks")
      .insert({ title: "Сам себе", object_id: objectId, assignee_id: ivan.id });
    expect(insertTask.error).toBeTruthy();

    const insertObject = await ivan.client.from("objects").insert({ name: "x", address: "y" });
    expect(insertObject.error).toBeTruthy();

    await ivan.client.from("tasks").update({ title: "Взломано" }).eq("id", id);
    await ivan.client.from("tasks").delete().eq("id", id);
    const { data } = await manager.client.from("tasks").select("title").eq("id", id).single();
    expect(data?.title).toBe("Задача");
  });

  it("не может изменить чужую задачу через смену статуса", async () => {
    const foreign = await createTask(petr.id, otherObjectId);
    const { error } = await move(ivan.client, foreign, "in_progress");
    expect(error?.message).toBe("Задача не найдена");
    expect(await statusOf(foreign)).toBe("new");
  });
});

describe("статусы", () => {
  it("прямое изменение статуса запрещено всем", async () => {
    const id = await createTask();
    for (const client of [ivan.client, manager.client]) {
      const { error } = await client.from("tasks").update({ status: "accepted" }).eq("id", id);
      expect(error).toBeTruthy();
    }
    expect(await statusOf(id)).toBe("new");
  });

  it("нельзя создать задачу сразу с другим статусом или автором", async () => {
    const status = await manager.client
      .from("tasks")
      .insert({ title: "x", object_id: objectId, assignee_id: ivan.id, status: "accepted" });
    expect(status.error).toBeTruthy();
    const author = await manager.client
      .from("tasks")
      .insert({ title: "x", object_id: objectId, assignee_id: ivan.id, author_id: ivan.id });
    expect(author.error).toBeTruthy();
  });

  it("исполнителем нельзя назначить постановщика", async () => {
    const { error } = await manager.client
      .from("tasks")
      .insert({ title: "x", object_id: objectId, assignee_id: manager.id });
    expect(error).toBeTruthy();
  });

  it("проходит весь разрешённый цикл", async () => {
    const id = await createTask();
    expect((await move(ivan.client, id, "in_progress")).error).toBeNull();
    expect((await move(ivan.client, id, "review")).error).toBeNull();
    expect((await move(manager.client, id, "rework", "Переделать")).error).toBeNull();
    expect((await move(ivan.client, id, "in_progress")).error).toBeNull();
    expect((await move(ivan.client, id, "review")).error).toBeNull();
    expect((await move(manager.client, id, "accepted")).error).toBeNull();
    expect(await statusOf(id)).toBe("accepted");
  });

  it.each([
    ["new", "review"],
    ["new", "accepted"],
    ["new", "rework"],
    ["in_progress", "new"],
    ["in_progress", "accepted"],
    ["review", "in_progress"],
    ["review", "new"],
  ])("переход %s → %s запрещён даже постановщику и исполнителю", async (from, to) => {
    const id = await createTask();
    if (from !== "new") await move(ivan.client, id, "in_progress");
    if (from === "review") await move(ivan.client, id, "review");
    expect(await statusOf(id)).toBe(from);
    expect((await move(ivan.client, id, to, "комментарий")).error).toBeTruthy();
    expect((await move(manager.client, id, to, "комментарий")).error).toBeTruthy();
    expect(await statusOf(id)).toBe(from);
  });

  it("из статуса «Принята» переходов нет", async () => {
    const id = await createTask();
    await move(ivan.client, id, "in_progress");
    await move(ivan.client, id, "review");
    await move(manager.client, id, "accepted");
    for (const to of ["new", "in_progress", "review", "rework"]) {
      expect((await move(manager.client, id, to, "x")).error).toBeTruthy();
    }
  });

  it("роли соблюдаются", async () => {
    const id = await createTask();
    expect((await move(manager.client, id, "in_progress")).error).toBeTruthy();
    expect((await move(petr.client, id, "in_progress")).error).toBeTruthy();
    await move(ivan.client, id, "in_progress");
    await move(ivan.client, id, "review");
    expect((await move(ivan.client, id, "accepted")).error).toBeTruthy();
    expect((await move(ivan.client, id, "rework", "сам себе")).error).toBeTruthy();
  });

  it.each([[null], [""], ["   "]])("на доработку нельзя без комментария: %j", async (comment) => {
    const id = await createTask();
    await move(ivan.client, id, "in_progress");
    await move(ivan.client, id, "review");
    const { error } = await manager.client.rpc("change_task_status", {
      p_task_id: id,
      p_to_status: "rework",
      p_comment: comment,
    });
    expect(error).toBeTruthy();
    expect(await statusOf(id)).toBe("review");
  });
});

describe("история", () => {
  it("записывает кто, откуда, куда и комментарий", async () => {
    const id = await createTask();
    await move(ivan.client, id, "in_progress");
    await move(ivan.client, id, "review");
    await move(manager.client, id, "rework", "  Исправить  ");
    const { data } = await ivan.client
      .from("task_status_history")
      .select("from_status,to_status,changed_by,comment")
      .eq("task_id", id)
      .order("id");
    expect(data).toEqual([
      { from_status: null, to_status: "new", changed_by: manager.id, comment: null },
      { from_status: "new", to_status: "in_progress", changed_by: ivan.id, comment: null },
      { from_status: "in_progress", to_status: "review", changed_by: ivan.id, comment: null },
      { from_status: "review", to_status: "rework", changed_by: manager.id, comment: "Исправить" },
    ]);
  });

  it("нельзя подделать, изменить или удалить через API", async () => {
    const id = await createTask();
    for (const client of [ivan.client, manager.client]) {
      const insert = await client.from("task_status_history").insert({
        task_id: id,
        to_status: "accepted",
        changed_by: manager.id,
      });
      expect(insert.error).toBeTruthy();
      const update = await client.from("task_status_history").update({ comment: "x" }).eq("task_id", id);
      expect(update.error).toBeTruthy();
      const remove = await client.from("task_status_history").delete().eq("task_id", id);
      expect(remove.error).toBeTruthy();
    }
    const { data } = await manager.client.from("task_status_history").select("id").eq("task_id", id);
    expect(data).toHaveLength(1);
  });

  it("даже service_role не может её переписать", async () => {
    const id = await createTask();
    const { error } = await admin.from("task_status_history").delete().eq("task_id", id);
    expect(error).toBeTruthy();
  });

  it("сохраняется после удаления задачи", async () => {
    const id = await createTask();
    const { error } = await manager.client.from("tasks").delete().eq("id", id);
    expect(error).toBeNull();
    const { data } = await manager.client.from("task_status_history").select("id").eq("task_id", id);
    expect(data).toHaveLength(1);
  });
});

describe("объекты", () => {
  it("объект с задачами удалить нельзя", async () => {
    await createTask();
    const { error } = await manager.client.from("objects").delete().eq("id", objectId);
    expect(error).toBeTruthy();
  });
});

describe("роли и профили", () => {
  it("пользователь не может повысить себе роль", async () => {
    await ivan.client.from("profiles").update({ role: "manager" }).eq("id", ivan.id);
    await ivan.client.auth.updateUser({ data: { role: "manager" } });
    const { data } = await admin.from("profiles").select("role").eq("id", ivan.id).single();
    expect(data?.role).toBe("executor");
    const { data: isManager } = await ivan.client.rpc("is_manager");
    expect(isManager).toBe(false);
  });
});
