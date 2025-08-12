import { useEffect, useState } from "react";
import { api } from "../lib/api";
export function useAuth(idToken: string | null) {
  const [jwt, setJwt] = useState<string | null>(null);
  useEffect(() => {
    if (!idToken) return;
    api.post("auth/line", { json: { id_token: idToken, store_id: import.meta.env.VITE_STORE_ID } })
      .json<{ token: string }>()
      .then(r => setJwt(r.token));
  }, [idToken]);
  return jwt;
}