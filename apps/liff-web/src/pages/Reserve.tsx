import { useLiff } from "../hooks/useLiff";
import { useAuth } from "../hooks/useAuth";
import { api } from "../lib/api";

export default function Reserve() {
  const { ready, idToken } = useLiff();
  const jwt = useAuth(idToken);

  async function createReservation() {
    if (!jwt) return;
    const start = new Date(); start.setHours(start.getHours() + 2);
    await api.post("reservations", {
      headers: { Authorization: `Bearer ${jwt}` },
      json: {
        store_id: import.meta.env.VITE_STORE_ID,
        menu_id: "replace-with-real-menu-uuid",
        start_at: start.toISOString(),
      }
    });
    alert("予約を受け付けました（ダミー）");
  }

  if (!ready) return <p>Loading...</p>;
  return (
    <main className="p-4">
      <h1>予約デモ</h1>
      <button onClick={createReservation}>2時間後に予約する</button>
    </main>
  );
}