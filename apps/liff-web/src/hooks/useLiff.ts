import { useEffect, useState } from "react";
export function useLiff() {
  const [ready, setReady] = useState(false);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<any>(null);
  useEffect(() => {
    (async () => {
      await (window as any).liff.init({ liffId: import.meta.env.VITE_LIFF_ID });
      if (!(window as any).liff.isLoggedIn()) (window as any).liff.login();
      setProfile(await (window as any).liff.getProfile());
      setIdToken((window as any).liff.getIDToken());
      setReady(true);
    })();
  }, []);
  return { ready, idToken, profile };
}