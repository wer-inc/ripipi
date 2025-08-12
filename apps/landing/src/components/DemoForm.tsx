"use client";

import { useState } from "react";

export default function DemoForm() {
  const [formData, setFormData] = useState({
    storeName: "",
    phone: "",
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    alert(`デモ予約を受け付けました: ${formData.storeName} (${formData.phone})`);
  };

  return (
    <section id="demo" className="py-16 px-4 bg-emerald-600 text-white">
      <div className="max-w-2xl mx-auto text-center">
        <h2 className="text-3xl font-bold mb-4">
          今すぐ15分デモを予約
        </h2>
        <p className="text-xl mb-8 text-emerald-100">
          実際の画面を見ながら、導入効果をご説明します
        </p>
        
        <form onSubmit={handleSubmit} className="bg-white rounded-2xl p-8 text-gray-900 shadow-xl">
          <div className="space-y-4">
            <div>
              <label htmlFor="storeName" className="block text-sm font-medium mb-1 text-left">
                店舗名 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="storeName"
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                placeholder="例: 美容室〇〇"
                value={formData.storeName}
                onChange={(e) => setFormData({ ...formData, storeName: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="phone" className="block text-sm font-medium mb-1 text-left">
                電話番号 <span className="text-red-500">*</span>
              </label>
              <input
                type="tel"
                id="phone"
                required
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
                placeholder="例: 03-1234-5678"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>
          </div>
          
          <button
            type="submit"
            className="w-full mt-6 bg-emerald-600 text-white py-4 rounded-xl hover:bg-emerald-700 transition-colors font-medium text-lg"
          >
            デモを予約する
          </button>
          
          <p className="text-sm text-gray-500 mt-4">
            ※ 営業日の10:00-18:00で調整させていただきます
          </p>
        </form>
        
        <div className="mt-8">
          <p className="mb-2">またはLINEで直接お問い合わせ</p>
          <button className="bg-[#06c755] text-white px-6 py-3 rounded-xl hover:bg-[#05b34a] transition-colors font-medium">
            LINEで問い合わせ
          </button>
        </div>
      </div>
    </section>
  );
}