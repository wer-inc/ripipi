import { useEffect, useState } from "react";
import liff from "@line/liff";

export function useLiff() {
  const [ready, setReady] = useState(false);
  const [idToken, setIdToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<any>(null);
  
  useEffect(() => {
    (async () => {
      try {
        await liff.init({ liffId: import.meta.env.VITE_LIFF_ID });
        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }
        const userProfile = await liff.getProfile();
        setProfile(userProfile);
        setIdToken(liff.getIDToken());
        setReady(true);
      } catch (error) {
        console.error("LIFF init error:", error);
      }
    })();
  }, []);
  
  return { ready, idToken, profile, liff };
}