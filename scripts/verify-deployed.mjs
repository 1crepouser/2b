// Проверяет развёрнутый проект после сида. Все попытки изменить данные должны быть отклонены,
// поэтому скрипт не оставляет следов в базе.
import { createClient } from "@supabase/supabase-js";

const { SUPABASE_URL: url, SUPABASE_ANON_KEY: anonKey, SEED_PASSWORD: password } = process.env;
const client = () => createClient(url, anonKey, { auth: { persistSession: false } });
let failed = 0;
const check = (name, ok) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) failed += 1;
};
async function signIn(email) {
  const c = client();
  const { data, error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return { c, id: data.user.id };
}

const anon = client();
for (const table of ["tasks", "objects", "profiles", "task_status_history"]) {
  const { data } = await anon.from(table).select("*");
  check(`аноним не читает ${table}`, !data || data.length === 0);
}
const signUp = await client().auth.signUp({ email: `x${Date.now()}@example.test`, password: "x".repeat(12) });
check("регистрация закрыта", Boolean(signUp.error) && !signUp.data.user);

const manager = await signIn("manager@example.test");
const ivan = await signIn("ivan@example.test");
const petr = await signIn("petr@example.test");

const all = (await manager.c.from("tasks").select("id,assignee_id,status")).data;
check("постановщик видит задачи обоих исполнителей", new Set(all.map((t) => t.assignee_id)).size === 2);

const ivanTasks = (await ivan.c.from("tasks").select("id,assignee_id")).data;
check("Иван видит только свои задачи", ivanTasks.length > 0 && ivanTasks.every((t) => t.assignee_id === ivan.id));
check("Иван видит не все объекты", (await ivan.c.from("objects").select("id")).data.length < 3);

const petrTask = all.find((t) => t.assignee_id === petr.id);
const foreignMove = await ivan.c.rpc("change_task_status", { p_task_id: petrTask.id, p_to_status: "review" });
check("Иван не меняет статус чужой задачи", Boolean(foreignMove.error));

const ivanTask = all.find((t) => t.assignee_id === ivan.id);
check(
  "прямая смена статуса запрещена",
  Boolean((await manager.c.from("tasks").update({ status: "accepted" }).eq("id", ivanTask.id)).error),
);
check(
  "исполнитель не создаёт задачи",
  Boolean((await ivan.c.from("tasks").insert({ title: "x", object_id: crypto.randomUUID(), assignee_id: ivan.id })).error),
);
const accepted = all.find((t) => t.status === "accepted");
check(
  "запрещённый переход отклонён",
  Boolean((await manager.c.rpc("change_task_status", { p_task_id: accepted.id, p_to_status: "new" })).error),
);
for (const [name, query] of [
  ["вставка", manager.c.from("task_status_history").insert({ task_id: ivanTask.id, to_status: "accepted", changed_by: manager.id })],
  ["изменение", manager.c.from("task_status_history").update({ comment: "x" }).eq("task_id", ivanTask.id)],
  ["удаление", manager.c.from("task_status_history").delete().eq("task_id", ivanTask.id)],
]) {
  check(`история: ${name} запрещено`, Boolean((await query).error));
}

console.log(failed ? `Ошибок: ${failed}` : "Все проверки пройдены");
process.exit(failed ? 1 : 0);
