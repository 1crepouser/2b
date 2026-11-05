import { useEffect, useState, type FormEvent } from "react";
import type { ObjectRow, Profile } from "../lib/domain";
import { supabase } from "../lib/supabase";

export interface TaskFormValues {
  title: string;
  description: string;
  object_id: string;
  assignee_id: string;
}

export function TaskForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial: TaskFormValues;
  submitLabel: string;
  onSubmit: (values: TaskFormValues) => Promise<string | null>;
}) {
  const [values, setValues] = useState(initial);
  const [executors, setExecutors] = useState<Profile[]>([]);
  const [objects, setObjects] = useState<ObjectRow[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void supabase
      .from("profiles")
      .select("*")
      .eq("role", "executor")
      .order("full_name")
      .then(({ data }) => setExecutors((data as Profile[]) ?? []));
    void supabase
      .from("objects")
      .select("*")
      .order("name")
      .then(({ data }) => setObjects((data as ObjectRow[]) ?? []));
  }, []);

  const set = (key: keyof TaskFormValues, value: string) => setValues((v) => ({ ...v, [key]: value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const message = await onSubmit(values);
    if (message) setError(message);
    setBusy(false);
  }

  return (
    <form className="form" onSubmit={submit}>
      <label>
        Название
        <input required value={values.title} onChange={(e) => set("title", e.target.value)} />
      </label>
      <label>
        Описание
        <textarea rows={3} value={values.description} onChange={(e) => set("description", e.target.value)} />
      </label>
      <label>
        Объект
        <select required value={values.object_id} onChange={(e) => set("object_id", e.target.value)}>
          <option value="">Выберите объект</option>
          {objects.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Исполнитель
        <select required value={values.assignee_id} onChange={(e) => set("assignee_id", e.target.value)}>
          <option value="">Выберите исполнителя</option>
          {executors.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="error">{error}</p>}
      <button disabled={busy}>{submitLabel}</button>
    </form>
  );
}
