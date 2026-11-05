import type { Session } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Profile } from "./domain";
import { supabase } from "./supabase";

interface SessionState {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  isManager: boolean;
}

const SessionContext = createContext<SessionState>({
  loading: true,
  session: null,
  profile: null,
  isManager: false,
});

export const useSession = () => useContext(SessionContext);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({
    loading: true,
    session: null,
    profile: null,
    isManager: false,
  });

  useEffect(() => {
    const load = async (session: Session | null) => {
      if (!session) {
        setState({ loading: false, session: null, profile: null, isManager: false });
        return;
      }
      const { data } = await supabase.from("profiles").select("*").eq("id", session.user.id).single();
      const profile = data as Profile | null;
      setState({ loading: false, session, profile, isManager: profile?.role === "manager" });
    };

    void supabase.auth.getSession().then(({ data }) => load(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      // Запрос к базе внутри колбэка блокирует auth-клиент, поэтому откладываем его.
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") setTimeout(() => void load(session), 0);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return <SessionContext.Provider value={state}>{children}</SessionContext.Provider>;
}
