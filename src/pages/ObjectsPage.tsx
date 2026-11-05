import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import type { ObjectRow } from "../lib/domain";
import { useSession } from "../lib/session";
import { supabase } from "../lib/supabase";

export function ObjectsPage() {
  const { isManager } = useSession();
  const [objects, setObjects] = useState<ObjectRow[] | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("objects").select("*").order("created_at");
    if (error) setError(error.message);
    setObjects((data as ObjectRow[]) ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: FormEvent) {
    event.preventDefault();
    setError("");
    const { error } = await supabase.from("objects").insert({ name, address });
    if (error) return setError(error.message);
    setName("");
    setAddress("");
    await load();
  }

  return (
    <>
      <h1>Объекты</h1>
      {error && <p className="error">{error}</p>}
      {objects === null && <p>Загрузка…</p>}
      {objects?.length === 0 && <p className="muted">Объектов пока нет.</p>}
      <ul className="list">
        {objects?.map((object) => (
          <li key={object.id} className="card">
            <Link to={`/objects/${object.id}`}>{object.name}</Link>
            <p className="muted">{object.address}</p>
          </li>
        ))}
      </ul>
      {isManager && (
        <form className="card form" onSubmit={create}>
          <h2>Новый объект</h2>
          <label>
            Название
            <input required value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label>
            Адрес
            <input required value={address} onChange={(e) => setAddress(e.target.value)} />
          </label>
          <button>Создать объект</button>
        </form>
      )}
    </>
  );
}
