import { useLiff } from "../hooks/useLiff";

export default function Membership() {
  const { ready, profile } = useLiff();
  
  const stamps = 8; // デモ用の固定値
  const maxStamps = 10;
  const points = 350;
  
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
        <h1 className="text-xl font-bold">会員証</h1>
        {profile && (
          <p className="text-sm mt-1">{profile.displayName}さん</p>
        )}
      </header>
      
      <main className="p-4 max-w-md mx-auto space-y-4">
        {/* スタンプカード */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-lg font-semibold mb-4">スタンプカード</h2>
          <div className="grid grid-cols-5 gap-2 mb-4">
            {Array.from({ length: maxStamps }).map((_, i) => (
              <div
                key={i}
                className={`aspect-square rounded-lg border-2 flex items-center justify-center ${
                  i < stamps
                    ? "bg-emerald-500 border-emerald-500"
                    : "border-gray-300"
                }`}
              >
                {i < stamps && (
                  <span className="text-white text-2xl">✓</span>
                )}
              </div>
            ))}
          </div>
          <p className="text-center text-sm text-gray-600">
            あと{maxStamps - stamps}個で特典GET！
          </p>
        </div>
        
        {/* ポイント */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-lg font-semibold mb-2">保有ポイント</h2>
          <p className="text-3xl font-bold text-emerald-600">
            {points.toLocaleString()} <span className="text-lg">pt</span>
          </p>
          <p className="text-sm text-gray-600 mt-2">
            100円につき1ポイント付与
          </p>
        </div>
        
        {/* 会員番号・QRコード */}
        <div className="bg-white p-6 rounded-lg shadow text-center">
          <h2 className="text-lg font-semibold mb-4">会員番号</h2>
          <div className="bg-gray-100 w-32 h-32 mx-auto mb-4 rounded flex items-center justify-center">
            <span className="text-gray-400">QRコード</span>
          </div>
          <p className="font-mono text-lg">DEMO-{profile?.userId?.slice(-8)}</p>
        </div>
        
        {/* 利用履歴 */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-lg font-semibold mb-3">最近の利用</h2>
          <div className="space-y-3">
            <div className="border-b pb-2">
              <p className="font-medium">カット</p>
              <p className="text-sm text-gray-600">2024/01/15 14:00</p>
            </div>
            <div className="border-b pb-2">
              <p className="font-medium">カット + カラー</p>
              <p className="text-sm text-gray-600">2023/12/20 15:30</p>
            </div>
          </div>
        </div>
        
        <a
          href="/reserve"
          className="block w-full bg-emerald-500 text-white text-center p-3 rounded-lg font-medium hover:bg-emerald-600"
        >
          予約する
        </a>
      </main>
    </div>
  );
}