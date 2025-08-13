"use client";

import { useState } from "react";

export default function DemoForm() {
  const [formData, setFormData] = useState({
    storeName: "",
    phone: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    // Simulate API call
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    setIsSubmitting(false);
    setIsSubmitted(true);
  };

  return (
    <section id="demo" className="relative py-20 px-4 bg-gradient-to-br from-emerald-600 to-emerald-700 text-white overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0">
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/20 rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-emerald-800/20 rounded-full blur-3xl" />
      </div>
      
      <div className="relative max-w-2xl mx-auto text-center">
        <h2 className="text-3xl md:text-4xl font-bold mb-4">
          今すぐ15分デモを予約
        </h2>
        <p className="text-xl mb-10 text-emerald-50">
          実際の画面を見ながら、導入効果をご説明します
        </p>
        
        {!isSubmitted ? (
          <form onSubmit={handleSubmit} className="bg-white rounded-3xl p-8 md:p-10 text-gray-900 shadow-2xl">
            <div className="space-y-6">
              <div className="text-left">
                <label htmlFor="storeName" className="block text-sm font-semibold mb-2 text-gray-700">
                  店舗名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="storeName"
                  required
                  className="w-full px-5 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all text-lg"
                  placeholder="例: 美容室〇〇"
                  value={formData.storeName}
                  onChange={(e) => setFormData({ ...formData, storeName: e.target.value })}
                  disabled={isSubmitting}
                />
              </div>
              <div className="text-left">
                <label htmlFor="phone" className="block text-sm font-semibold mb-2 text-gray-700">
                  電話番号 <span className="text-red-500">*</span>
                </label>
                <input
                  type="tel"
                  id="phone"
                  required
                  className="w-full px-5 py-3 border-2 border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 transition-all text-lg"
                  placeholder="例: 03-1234-5678"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  disabled={isSubmitting}
                />
              </div>
            </div>
            
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full mt-8 bg-emerald-600 text-white py-4 rounded-xl hover:bg-emerald-700 transition-all font-semibold text-lg shadow-lg hover:shadow-xl transform hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? "送信中..." : "デモを予約する"}
            </button>
            
            <p className="text-sm text-gray-500 mt-6">
              ※ 営業日の10:00-18:00で調整させていただきます
            </p>
          </form>
        ) : (
          <div className="bg-white rounded-3xl p-8 md:p-10 text-gray-900 shadow-2xl">
            <div className="text-center">
              <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-10 h-10 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <h3 className="text-2xl font-bold mb-2">ありがとうございます！</h3>
              <p className="text-gray-600 mb-6">
                デモ予約を受け付けました。<br />
                担当者より1営業日以内にご連絡いたします。
              </p>
              <button
                onClick={() => {
                  setIsSubmitted(false);
                  setFormData({ storeName: "", phone: "" });
                }}
                className="text-emerald-600 hover:text-emerald-700 font-medium"
              >
                別の店舗で予約する
              </button>
            </div>
          </div>
        )}
        
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <div className="flex items-center gap-2 text-emerald-100">
            <span>またはLINEで直接お問い合わせ</span>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </div>
          <a 
            href="#"
            className="bg-[#06c755] text-white px-6 py-3 rounded-xl hover:bg-[#05b34a] transition-all font-medium shadow-lg hover:shadow-xl transform hover:scale-105 flex items-center gap-2"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.365 9.863c.349 0 .63.285.63.631 0 .345-.281.63-.63.63H17.61v1.125h1.755c.349 0 .63.283.63.63 0 .344-.281.629-.63.629h-2.386c-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.63-.63h2.386c.346 0 .627.285.627.63 0 .349-.281.63-.63.63H17.61v1.125h1.755zm-3.855 3.016c0 .27-.174.51-.432.596-.064.021-.133.031-.199.031-.211 0-.391-.09-.51-.25l-2.443-3.317v2.94c0 .344-.279.629-.631.629-.346 0-.626-.285-.626-.629V8.108c0-.27.173-.51.43-.595.06-.023.136-.033.194-.033.195 0 .375.104.495.254l2.462 3.33V8.108c0-.345.282-.63.63-.63.345 0 .63.285.63.63v4.771zm-5.741 0c0 .344-.282.629-.631.629-.345 0-.627-.285-.627-.629V8.108c0-.345.282-.63.627-.63.349 0 .631.285.631.63v4.771zm-2.466.629H4.917c-.345 0-.63-.285-.63-.629V8.108c0-.345.285-.63.63-.63.349 0 .63.285.63.63v4.141h1.756c.348 0 .629.283.629.63 0 .344-.282.629-.629.629M24 10.314C24 4.943 18.615.572 12 .572S0 4.943 0 10.314c0 4.811 4.27 8.842 10.035 9.608.391.082.923.258 1.058.59.12.301.079.766.038 1.08l-.164 1.02c-.045.301-.24 1.186 1.049.645 1.291-.539 6.916-4.078 9.436-6.975C23.176 14.393 24 12.458 24 10.314"></path>
            </svg>
            LINEで問い合わせ
          </a>
        </div>

        {/* QR Code repeat */}
        <div className="mt-12 pt-8 border-t border-emerald-500/30">
          <p className="text-emerald-100 mb-4">スマホから直接体験できます</p>
          <div className="inline-block p-4 bg-white/10 backdrop-blur rounded-2xl">
            <div className="w-32 h-32 bg-white rounded-xl flex items-center justify-center">
              <svg className="w-28 h-28 text-gray-300" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect width="200" height="200" fill="white"/>
                <path d="M40 40h30v30H40zM130 40h30v30h-30zM40 130h30v30H40z" fill="currentColor"/>
                <path d="M80 40h10v10H80zM100 40h10v10h-10zM40 80h10v10H40zM60 80h10v10H60zM80 80h10v10H80zM100 80h10v10h-10zM120 80h10v10h-10zM140 80h10v10h-10zM40 100h10v10H40zM80 100h10v10H80zM120 100h10v10h-10zM160 100h10v10h-10zM80 120h10v10H80zM100 120h10v10h-10zM120 120h10v10h-10zM140 120h10v10h-10zM80 140h10v10H80zM100 140h10v10h-10zM120 140h10v10h-10zM140 140h10v10h-10zM160 140h10v10h-10z" fill="currentColor"/>
              </svg>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}