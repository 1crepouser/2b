import { createClient } from "@supabase/supabase-js";

// Во фронтенде только публичный anon-ключ: доступ к данным ограничивает RLS в базе.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);
