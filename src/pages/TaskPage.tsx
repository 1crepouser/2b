import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  availableActions,
  formatDate,
  statusLabels,
  type HistoryRow,
  type Profile,
  type Task,
  type TaskAction,
} from "../lib/domain";
import { useSession } from "../lib/session";
import { supabase } from "../lib/supabase";
import { TaskForm } from "./TaskForm";
import { StatusBadge } from "./TaskList";

export function TaskPage() {
  const { id = "" } = useParams();
  const { session, isManager } = useSession();
  const navigate = useNavigate();
  const [task, setTask] = useState<Task | null | undefined>(undefined);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [people, setPeople] = useState<Map<string, string>>(new Map());
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<TaskAction | null>(null);
  const [comment, setComment] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [taskResult, historyResult, profilesResult] = await Promise.all([
      supabase.from("tasks").select("*, objects(name)").eq("id", id).maybeSingle(),
      supabase.from("task_status_history").select("*").eq("task_id", id).order("id"),
      supabase.from("profiles").select("*"),
    ]);
    setTask(taskResult.data as Task | null);
    setHistory((historyResult.data as HistoryRow[]) ?? []);
    setPeople(new Map(((profilesResult.data as Profile[]) ?? []).map((p) => [p.id, p.full_name])));
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const actions = useMemo(
    () => (task ? availableActions(task.status, isManager, task.assignee_id === session?.user.id) : []),
    [task, isManager, session],
  );

  async function run(action: TaskAction, actionComment: string) {
    if (action.needsComment && !actionComment.trim()) return setError("Укажите, что нужно доработать");
    setBusy(true);
    setError("");
    const { error } = await supabase.rpc("change_task_status", {
      p_task_id: id,
      p_to_status: action.to,
      p_comment: actionComment.trim() || null,
    });
    if (error) setError(error.message);
    else {
      setPending(null);
      setComment("");
    }
    await load();
    setBusy(false);
  }

  async function remove() {
    if (!window.confirm("Удалить задачу?")) return;
    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (error) return setError(error.message);
    navigate(task ? `/objects/${task.object_id}` : "/objects");
  }

  if (task === undefined) return <p>Загрузка…</p>;
  if (task === null) return <p>Задача не найдена или недоступна.</p>;

  return (
    <>
      <p>
        <Link to={`/objects/${task.object_id}`}>← {task.objects?.name}</Link>
      </p>
      {editing ? (
        <div className="card">
          <h2>Редактирование</h2>
          <TaskForm
            initial={{
              title: task.title,
              description: task.description,
              object_id: task.object_id,
              assignee_id: task.assignee_id,
            }}
            submitLabel="Сохранить"
            onSubmit={async (values) => {
              const { error } = await supabase.from("tasks").update(values).eq("id", id);
              if (error) return error.message;
              setEditing(false);
              await load();
              return null;
            }}
          />
          <button className="secondary" onClick={() => setEditing(false)}>
            Отмена
          </button>
        </div>
      ) : (
        <>
          <div className="row">
            <h1>{task.title}</h1>
            <StatusBadge status={task.status} />
          </div>
          {task.description && <p className="description">{task.description}</p>}
          <dl className="facts">
            <dt>Исполнитель</dt>
            <dd>{people.get(task.assignee_id)}</dd>
            <dt>Автор</dt>
            <dd>{people.get(task.author_id)}</dd>
            <dt>Создана</dt>
            <dd>{formatDate(task.created_at)}</dd>
          </dl>
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

      {actions.length > 0 && (
        <section className="card">
          <h2>Действия</h2>
          <div className="actions">
            {actions.map((action) => (
              <button
                key={action.to}
                disabled={busy}
                className={action.needsComment ? "secondary" : undefined}
                onClick={() => (action.needsComment ? setPending(action) : void run(action, ""))}
              >
                {action.label}
              </button>
            ))}
          </div>
          {pending && (
            <div className="form">
              <label>
                Комментарий
                <textarea rows={3} value={comment} onChange={(e) => setComment(e.target.value)} />
              </label>
              <button disabled={busy} onClick={() => void run(pending, comment)}>
                {pending.label}
              </button>
            </div>
          )}
        </section>
      )}
      {error && <p className="error">{error}</p>}

      <h2>История</h2>
      <ul className="history">
        {history.map((row) => (
          <li key={row.id}>
            <strong>
              {row.from_status ? `${statusLabels[row.from_status]} → ` : ""}
              {statusLabels[row.to_status]}
            </strong>
            <span className="muted">
              {people.get(row.changed_by)} · {formatDate(row.created_at)}
            </span>
            {row.comment && <p>{row.comment}</p>}
          </li>
        ))}
      </ul>
    </>
  );
}
