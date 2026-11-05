import { useEffect, useState } from "react";
import type { Task } from "../lib/domain";
import { useSession } from "../lib/session";
import { supabase } from "../lib/supabase";
import { TaskList } from "./TaskList";

export function MyTasksPage() {
  const { session } = useSession();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [error, setError] = useState("");
  const userId = session?.user.id;

  useEffect(() => {
    if (!userId) return;
    void supabase
      .from("tasks")
      .select("*, objects(name)")
      .eq("assignee_id", userId)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        setTasks((data as Task[]) ?? []);
      });
  }, [userId]);

  return (
    <>
      <h1>Мои задачи</h1>
      {error && <p className="error">{error}</p>}
      {tasks === null ? <p>Загрузка…</p> : <TaskList tasks={tasks} showObject />}
    </>
  );
}
