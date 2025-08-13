import { Link } from "react-router-dom";
import { useLiff } from "../hooks/useLiff";

export default function Home() {
  const { ready, profile } = useLiff();
  
  if (!ready) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-500">読み込み中...</p>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50 to-white">
      <header className="bg-emerald-500 text-white p-4">
        <h1 className="text-xl font-bold">Ripipi デモ</h1>
        {profile && (
          <p className="text-sm mt-1">こんにちは、{profile.displayName}さん</p>
        )}
      </header>
      
      <main className="p-6 max-w-md mx-auto">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-gray-800 mb-2">
            LINEで簡単予約体験
          </h2>
          <p className="text-gray-600">
            予約から会員証まで、すべてLINEで完結
          </p>
        </div>
        
        <div className="space-y-4">
          <Link
            to="/reserve"
            className="block bg-white p-6 rounded-lg shadow hover:shadow-lg transition-shadow"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-800">
                  予約する
                </h3>
                <p className="text-sm text-gray-600 mt-1">
                  空き時間を確認して予約
                </p>
              </div>
              <span className="text-2xl">📅</span>
            </div>
          </Link>
          
          <Link
            to="/membership"
            className="block bg-white p-6 rounded-lg shadow hover:shadow-lg transition-shadow"
          >
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-800">
                  会員証
                </h3>
                <p className="text-sm text-gray-600 mt-1">
                  スタンプ・ポイントを確認
                </p>
              </div>
              <span className="text-2xl">💳</span>
            </div>
          </Link>
          
          <div className="bg-emerald-50 p-6 rounded-lg">
            <h3 className="text-lg font-semibold text-emerald-800 mb-2">
              デモの特徴
            </h3>
            <ul className="space-y-2 text-sm text-emerald-700">
              <li className="flex items-start">
                <span className="mr-2">✓</span>
                <span>予約後に確認通知が届きます</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2">✓</span>
                <span>前日・当日にリマインド通知</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2">✓</span>
                <span>スタンプが貯まると特典GET</span>
              </li>
            </ul>
          </div>
        </div>
        
        <div className="mt-8 text-center text-sm text-gray-500">
          <p>このデモはRipipiの機能を体験できます</p>
          <p className="mt-1">実際の予約は行われません</p>
        </div>
      </main>
    </div>
  );
}