import { useEffect, useState } from "react";
import { api } from "../lib/api";

export function useAuth(idToken: string | null) {
  const [jwt, setJwt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  
  useEffect(() => {
    if (!idToken) return;
    
    (async () => {
      setLoading(true);
      try {
        const response = await api.post("auth/line", { 
          json: { 
            id_token: idToken, 
            store_id: import.meta.env.VITE_STORE_ID 
          } 
        }).json<{ token: string }>();
        setJwt(response.token);
      } catch (err) {
        setError(err as Error);
      } finally {
        setLoading(false);
      }
    })();
  }, [idToken]);
  
  return { jwt, loading, error };
}