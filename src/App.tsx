import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { useSession } from "./lib/session";
import { supabase } from "./lib/supabase";
import { LoginPage } from "./pages/LoginPage";
import { MyTasksPage } from "./pages/MyTasksPage";
import { ObjectPage } from "./pages/ObjectPage";
import { ObjectsPage } from "./pages/ObjectsPage";
import { TaskPage } from "./pages/TaskPage";

export default function App() {
  const { loading, session, profile, isManager } = useSession();

  if (loading) return <p className="page">Загрузка…</p>;
  if (!session) return <LoginPage />;

  return (
    <>
      <header className="header">
        <nav>
          <NavLink to="/objects">Объекты</NavLink>
          {!isManager && <NavLink to="/my-tasks">Мои задачи</NavLink>}
        </nav>
        <div className="user">
          <span>
            {profile?.full_name} · {isManager ? "постановщик" : "исполнитель"}
          </span>
          <button className="secondary" onClick={() => void supabase.auth.signOut()}>
            Выйти
          </button>
        </div>
      </header>
      <main className="page">
        <Routes>
          <Route path="/objects" element={<ObjectsPage />} />
          <Route path="/objects/:id" element={<ObjectPage />} />
          <Route path="/tasks/:id" element={<TaskPage />} />
          <Route path="/my-tasks" element={<MyTasksPage />} />
          <Route path="*" element={<Navigate to={isManager ? "/objects" : "/my-tasks"} replace />} />
        </Routes>
      </main>
    </>
  );
}
