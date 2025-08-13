"use client";

import { useState } from "react";

export default function ROICalculator() {
  const [bookings, setBookings] = useState(50);
  const [avgPrice, setAvgPrice] = useState(8000);
  const [noShowRate, setNoShowRate] = useState(15);

  const currentLoss = (bookings * avgPrice * noShowRate) / 100;
  const newNoShowRate = 10; // 導入後の想定ノーショー率
  const newLoss = (bookings * avgPrice * newNoShowRate) / 100;
  const savings = currentLoss - newLoss;
  const yearlySavings = savings * 12;

  return (
    <section className="py-20 px-4 bg-gradient-to-br from-emerald-50 to-blue-50">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            導入効果をシミュレーション
          </h2>
          <p className="text-lg text-gray-600">
            あなたのお店でどれくらいノーショー損失を削減できるか計算してみましょう
          </p>
        </div>
        <div className="bg-white p-8 md:p-10 rounded-3xl shadow-xl border border-gray-100">
          <div className="grid md:grid-cols-3 gap-8 mb-10">
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-gray-700">
                月間予約件数
              </label>
              <div className="relative">
                <input
                  type="number"
                  value={bookings}
                  onChange={(e) => setBookings(Number(e.target.value))}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-emerald-500 focus:outline-none transition-colors text-lg"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500">件</span>
              </div>
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-gray-700">
                平均単価
              </label>
              <div className="relative">
                <input
                  type="number"
                  value={avgPrice}
                  onChange={(e) => setAvgPrice(Number(e.target.value))}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-emerald-500 focus:outline-none transition-colors text-lg"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500">円</span>
              </div>
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-gray-700">
                現在のノーショー率
              </label>
              <div className="relative">
                <input
                  type="number"
                  value={noShowRate}
                  onChange={(e) => setNoShowRate(Number(e.target.value))}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl focus:border-emerald-500 focus:outline-none transition-colors text-lg"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500">%</span>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-r from-emerald-50 to-blue-50 rounded-2xl p-8 mb-8">
            <div className="grid md:grid-cols-2 gap-8 mb-6">
              <div className="text-center">
                <p className="text-gray-600 mb-2 font-medium">月間削減見込額</p>
                <p className="text-4xl md:text-5xl font-bold text-emerald-600">
                  ¥{savings.toLocaleString()}
                </p>
              </div>
              <div className="text-center">
                <p className="text-gray-600 mb-2 font-medium">年間削減見込額</p>
                <p className="text-4xl md:text-5xl font-bold text-blue-600">
                  ¥{yearlySavings.toLocaleString()}
                </p>
              </div>
            </div>
            <div className="text-center">
              <div className="inline-flex items-center gap-2 bg-white/70 rounded-full px-4 py-2">
                <svg className="w-5 h-5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M12 7a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0V8.414l-4.293 4.293a1 1 0 01-1.414 0L8 10.414l-4.293 4.293a1 1 0 01-1.414-1.414l5-5a1 1 0 011.414 0L11 10.586 14.586 7H12z" clipRule="evenodd" />
                </svg>
                <span className="text-sm font-medium text-gray-700">
                  ノーショー率 {noShowRate}% → {newNoShowRate}% に改善
                </span>
              </div>
            </div>
          </div>

          <div className="text-center">
            <p className="text-gray-600 mb-6">
              この金額があれば、スタッフの教育や店舗改善に投資できます
            </p>
            <a
              href="#demo"
              className="inline-block bg-emerald-500 text-white px-8 py-4 rounded-2xl hover:bg-emerald-600 transition-all transform hover:scale-105 text-lg font-semibold shadow-lg hover:shadow-xl"
            >
              削減効果を実現する →
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}