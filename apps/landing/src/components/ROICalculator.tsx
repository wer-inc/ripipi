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

  return (
    <section className="py-16 px-4">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-3xl font-bold text-center mb-12">
          効果をシミュレーション
        </h2>
        <div className="bg-white p-8 rounded-xl shadow-lg">
          <div className="grid md:grid-cols-3 gap-6 mb-8">
            <div>
              <label className="block text-sm font-medium mb-2">
                月の予約件数
              </label>
              <input
                type="number"
                value={bookings}
                onChange={(e) => setBookings(Number(e.target.value))}
                className="w-full px-4 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">
                平均単価（円）
              </label>
              <input
                type="number"
                value={avgPrice}
                onChange={(e) => setAvgPrice(Number(e.target.value))}
                className="w-full px-4 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">
                現在のノーショー率（%）
              </label>
              <input
                type="number"
                value={noShowRate}
                onChange={(e) => setNoShowRate(Number(e.target.value))}
                className="w-full px-4 py-2 border rounded-lg"
              />
            </div>
          </div>

          <div className="text-center">
            <p className="text-gray-600 mb-2">月間削減見込額</p>
            <p className="text-4xl font-bold text-blue-600 mb-4">
              ¥{savings.toLocaleString()}
            </p>
            <p className="text-sm text-gray-600 mb-6">
              （ノーショー率 {noShowRate}% → {newNoShowRate}% に改善した場合）
            </p>
            <a
              href="#demo"
              className="inline-block bg-blue-600 text-white px-8 py-3 rounded-2xl hover:bg-blue-700 transition-colors font-medium"
            >
              そのまま15分デモ
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}