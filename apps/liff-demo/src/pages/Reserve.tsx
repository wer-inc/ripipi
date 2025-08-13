import { useState } from "react";
import { useLiff } from "../hooks/useLiff";
import { useAuth } from "../hooks/useAuth";
import { api } from "../lib/api";

export default function Reserve() {
  const { ready, idToken, profile } = useLiff();
  const { jwt } = useAuth(idToken);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<"menu" | "time" | "confirm" | "done">("menu");
  
  const [selectedMenu, setSelectedMenu] = useState<string>("");
  const [selectedTime, setSelectedTime] = useState<string>("");
  
  const [menus, setMenus] = useState<any[]>([]);
  
  const timeSlots = [
    "10:00", "10:30", "11:00", "11:30", "12:00", 
    "13:00", "13:30", "14:00", "14:30", "15:00",
    "15:30", "16:00", "16:30", "17:00", "17:30"
  ];
  
  async function createReservation() {
    if (!jwt) return;
    
    setLoading(true);
    try {
      const start = new Date();
      const [hours, minutes] = selectedTime.split(":").map(Number);
      start.setHours(hours, minutes, 0, 0);
      
      await api.post("reservations", {
        headers: { Authorization: `Bearer ${jwt}` },
        json: {
          store_id: import.meta.env.VITE_STORE_ID,
          menu_id: selectedMenu,
          start_at: start.toISOString(),
        }
      });
      
      setStep("done");
    } catch (error) {
      console.error("Reservation error:", error);
      alert("予約に失敗しました");
    } finally {
      setLoading(false);
    }
  }
  
  if (!ready) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">読み込み中...</p>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-emerald-500 text-white p-4">
        <h1 className="text-xl font-bold">Ripipi 予約デモ</h1>
        {profile && (
          <p className="text-sm mt-1">こんにちは、{profile.displayName}さん</p>
        )}
      </header>
      
      <main className="p-4 max-w-md mx-auto">
        {step === "menu" && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold mb-3">メニューを選択</h2>
            {menus.map((menu) => (
              <button
                key={menu.id}
                onClick={() => {
                  setSelectedMenu(menu.id);
                  setStep("time");
                }}
                className="w-full bg-white p-4 rounded-lg shadow text-left hover:shadow-md transition-shadow"
              >
                <div className="font-medium">{menu.name}</div>
                <div className="text-sm text-gray-500 mt-1">
                  {menu.duration}分 / ¥{menu.price.toLocaleString()}
                </div>
              </button>
            ))}
          </div>
        )}
        
        {step === "time" && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold mb-3">日時を選択</h2>
            <div className="bg-white p-4 rounded-lg shadow">
              <p className="text-sm text-gray-600 mb-3">本日の空き時間</p>
              <div className="grid grid-cols-3 gap-2">
                {timeSlots.map((time) => (
                  <button
                    key={time}
                    onClick={() => {
                      setSelectedTime(time);
                      setStep("confirm");
                    }}
                    className="p-2 border rounded hover:bg-emerald-50 hover:border-emerald-300 transition-colors"
                  >
                    {time}
                  </button>
                ))}
              </div>
            </div>
            <button
              onClick={() => setStep("menu")}
              className="text-gray-600 underline"
            >
              メニュー選択に戻る
            </button>
          </div>
        )}
        
        {step === "confirm" && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold mb-3">予約内容の確認</h2>
            <div className="bg-white p-4 rounded-lg shadow space-y-3">
              <div>
                <p className="text-sm text-gray-600">メニュー</p>
                <p className="font-medium">
                  {menus.find(m => m.id === selectedMenu)?.name}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600">日時</p>
                <p className="font-medium">本日 {selectedTime}</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">お名前</p>
                <p className="font-medium">{profile?.displayName}</p>
              </div>
            </div>
            
            <button
              onClick={createReservation}
              disabled={loading}
              className="w-full bg-emerald-500 text-white p-3 rounded-lg font-medium hover:bg-emerald-600 disabled:opacity-50"
            >
              {loading ? "予約中..." : "予約を確定する"}
            </button>
            
            <button
              onClick={() => setStep("time")}
              className="text-gray-600 underline"
            >
              時間選択に戻る
            </button>
          </div>
        )}
        
        {step === "done" && (
          <div className="space-y-4 text-center">
            <div className="bg-white p-8 rounded-lg shadow">
              <div className="text-5xl mb-4">✅</div>
              <h2 className="text-xl font-semibold mb-2">予約が完了しました！</h2>
              <p className="text-gray-600 mb-4">
                前日と当日にLINEでリマインド通知をお送りします
              </p>
              <div className="bg-emerald-50 p-3 rounded text-sm text-emerald-700">
                予約番号: DEMO-{Date.now().toString().slice(-6)}
              </div>
            </div>
            
            <a
              href="/membership"
              className="inline-block text-emerald-600 underline"
            >
              会員証を見る
            </a>
          </div>
        )}
      </main>
    </div>
  );
}