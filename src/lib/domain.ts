export type Role = "manager" | "executor";
export type TaskStatus = "new" | "in_progress" | "review" | "accepted" | "rework";

export interface Profile {
  id: string;
  full_name: string;
  role: Role;
}
export interface ObjectRow {
  id: string;
  name: string;
  address: string;
}
export interface Task {
  id: string;
  title: string;
  description: string;
  object_id: string;
  assignee_id: string;
  author_id: string;
  status: TaskStatus;
  created_at: string;
  objects?: { name: string } | null;
}
export interface HistoryRow {
  id: number;
  from_status: TaskStatus | null;
  to_status: TaskStatus;
  changed_by: string;
  comment: string | null;
  created_at: string;
}

export const statusLabels: Record<TaskStatus, string> = {
  new: "Новая",
  in_progress: "В работе",
  review: "На проверке",
  accepted: "Принята",
  rework: "На доработке",
};

export interface TaskAction {
  to: TaskStatus;
  label: string;
  needsComment?: boolean;
}

/** Только подсказка для кнопок. Настоящая проверка находится в базе, в change_task_status. */
export function availableActions(status: TaskStatus, isManager: boolean, isAssignee: boolean): TaskAction[] {
  if (isAssignee && status === "new") return [{ to: "in_progress", label: "Взять в работу" }];
  if (isAssignee && status === "in_progress") return [{ to: "review", label: "Отправить на проверку" }];
  if (isAssignee && status === "rework") return [{ to: "in_progress", label: "Вернуть в работу" }];
  if (isManager && status === "review") {
    return [
      { to: "accepted", label: "Принять" },
      { to: "rework", label: "Вернуть на доработку", needsComment: true },
    ];
  }
  return [];
}

export const formatDate = (value: string) =>
  new Date(value).toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short" });
