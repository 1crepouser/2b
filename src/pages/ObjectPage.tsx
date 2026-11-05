import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { ObjectRow, Task } from "../lib/domain";
import { useSession } from "../lib/session";
import { supabase } from "../lib/supabase";
import { TaskForm } from "./TaskForm";
import { TaskList } from "./TaskList";

export function ObjectPage() {
  const { id = "" } = useParams();
  const { session, isManager } = useSession();
  const navigate = useNavigate();
  const [object, setObject] = useState<ObjectRow | null | undefined>(undefined);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const [objectResult, tasksResult] = await Promise.all([
      supabase.from("objects").select("*").eq("id", id).maybeSingle(),
      supabase.from("tasks").select("*").eq("object_id", id).order("created_at", { ascending: false }),
    ]);
    setObject(objectResult.data as ObjectRow | null);
    setTasks((tasksResult.data as Task[]) ?? []);
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const { error } = await supabase
      .from("objects")
      .update({ name: String(form.get("name")), address: String(form.get("address")) })
      .eq("id", id);
    if (error) return setError(error.message);
    setError("");
    setEditing(false);
    await load();
  }

  async function remove() {
    if (!window.confirm("Удалить объект?")) return;
    const { error } = await supabase.from("objects").delete().eq("id", id);
    if (error) {
      return setError(
        error.code === "23503" ? "Нельзя удалить объект, пока в нём есть задачи" : error.message,
      );
    }
    navigate("/objects");
  }

  if (object === undefined) return <p>Загрузка…</p>;
  if (object === null) return <p>Объект не найден или недоступен.</p>;

  return (
    <>
      <p>
        <Link to="/objects">← Все объекты</Link>
      </p>
      {editing ? (
        <form className="card form" onSubmit={save}>
          <label>
            Название
            <input name="name" required defaultValue={object.name} />
          </label>
          <label>
            Адрес
            <input name="address" required defaultValue={object.address} />
          </label>
          <div className="actions">
            <button>Сохранить</button>
            <button type="button" className="secondary" onClick={() => setEditing(false)}>
              Отмена
            </button>
          </div>
        </form>
      ) : (
        <>
          <h1>{object.name}</h1>
          <p className="muted">{object.address}</p>
          {isManager && (
            <div className="actions">
              <button className="secondary" onClick={() => setEditing(true)}>
                Редактировать
              </button>
              <button className="danger" onClick={() => void remove()}>
                Удалить
              </button>
            </div>
          )}
        </>
      )}
      {error && <p className="error">{error}</p>}

      <h2>Задачи</h2>
      <TaskList tasks={tasks} />

      {isManager &&
        (creating ? (
          <div className="card">
            <h2>Новая задача</h2>
            <TaskForm
              initial={{ title: "", description: "", object_id: id, assignee_id: "" }}
              submitLabel="Создать задачу"
              onSubmit={async (values) => {
                const { error } = await supabase.from("tasks").insert(values);
                if (error) return error.message;
                setCreating(false);
                await load();
                return null;
              }}
            />
          </div>
        ) : (
          session && <button onClick={() => setCreating(true)}>Новая задача</button>
        ))}
    </>
  );
}
