// Создаёт тестовых пользователей и данные. Запускается один раз с service_role-ключом,
// который хранится только в окружении и никогда не попадает во фронтенд или репозиторий.
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SEED_PASSWORD=... node scripts/seed.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;
const password = process.env.SEED_PASSWORD;
if (!url || !serviceKey || !anonKey || !password) {
  console.error("Нужны SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY и SEED_PASSWORD");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const users = [
  { email: "manager@example.test", full_name: "Анна Постановщик", role: "manager" },
  { email: "ivan@example.test", full_name: "Иван Исполнитель", role: "executor" },
  { email: "petr@example.test", full_name: "Пётр Исполнитель", role: "executor" },
];

const ids = {};
for (const u of users) {
  const { data, error } = await admin.auth.admin.createUser({
    email: u.email,
    password,
    email_confirm: true,
    app_metadata: { role: u.role, full_name: u.full_name },
  });
  if (error) throw error;
  ids[u.email] = data.user.id;
}

async function signIn(email) {
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return client;
}

const manager = await signIn("manager@example.test");
const ivan = await signIn("ivan@example.test");
const petr = await signIn("petr@example.test");
const ivanId = ids["ivan@example.test"];
const petrId = ids["petr@example.test"];

const { data: objects, error: objectsError } = await manager
  .from("objects")
  .insert([
    { name: "ЖК «Северный»", address: "Омск, ул. Строителей, 12" },
    { name: "Склад на Левом берегу", address: "Омск, ул. Индустриальная, 3" },
    { name: "Офис на Ленина", address: "Омск, ул. Ленина, 40" },
  ])
  .select();
if (objectsError) throw objectsError;

async function task(title, description, objectIndex, assigneeId) {
  const { data, error } = await manager
    .from("tasks")
    .insert({ title, description, object_id: objects[objectIndex].id, assignee_id: assigneeId })
    .select()
    .single();
  if (error) throw error;
  return data.id;
}
async function move(client, id, status, comment) {
  const { error } = await client.rpc("change_task_status", {
    p_task_id: id,
    p_to_status: status,
    p_comment: comment ?? null,
  });
  if (error) throw error;
}

await task("Завезти арматуру", "Партия на 2 секцию", 0, ivanId);

const inWork = await task("Залить фундамент", "Секция 1", 0, ivanId);
await move(ivan, inWork, "in_progress");

const review = await task("Проверить кровлю", "Составить акт и приложить фото", 1, petrId);
await move(petr, review, "in_progress");
await move(petr, review, "review");

const rework = await task("Смонтировать ворота", "Ворота №2", 1, petrId);
await move(petr, rework, "in_progress");
await move(petr, rework, "review");
await move(manager, rework, "rework", "Ворота перекошены, поправьте направляющие");

const accepted = await task("Покрасить стены", "Третий этаж", 2, ivanId);
await move(ivan, accepted, "in_progress");
await move(ivan, accepted, "review");
await move(manager, accepted, "accepted");

console.log("Готово. Пользователи:", users.map((u) => u.email).join(", "));
