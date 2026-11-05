import { Link } from "react-router-dom";
import { statusLabels, type Task } from "../lib/domain";

export function StatusBadge({ status }: { status: Task["status"] }) {
  return <span className={`badge badge-${status}`}>{statusLabels[status]}</span>;
}

export function TaskList({ tasks, showObject = false }: { tasks: Task[]; showObject?: boolean }) {
  if (tasks.length === 0) return <p className="muted">Задач нет.</p>;
  return (
    <ul className="list">
      {tasks.map((task) => (
        <li key={task.id} className="card row">
          <div>
            <Link to={`/tasks/${task.id}`}>{task.title}</Link>
            {showObject && <p className="muted">{task.objects?.name}</p>}
          </div>
          <StatusBadge status={task.status} />
        </li>
      ))}
    </ul>
  );
}
