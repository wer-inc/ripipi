"use client";

import { useState } from "react";

export default function FAQ() {
  const faqs = [
    {
      question: "他の予約システムと併用できますか？",
      answer: "はい、LINE予約を\"追加導線\"として使えます。既存システムはそのままで、LINE経由の予約を増やせます。",
    },
    {
      question: "導入までどれくらい？",
      answer: "最短3営業日です。初期設定は当社で代行するので、お客様の作業負担は最小限です。",
    },
    {
      question: "メッセージ配信の費用は？",
      answer: "LINE公式アカウントのプランに準拠します。無料プランでも月1,000通まで配信可能です。詳細はご案内します。",
    },
    {
      question: "データの所有権は？",
      answer: "店舗さまのものです。いつでもCSVエクスポート可能で、解約時もデータはお渡しします。",
    },
    {
      question: "キャンセル料の徴収は？",
      answer: "プロプランで事前決済/デポジットに対応しています。Stripeと連携し、安全に決済処理を行います。",
    },
    {
      question: "スタッフの教育は必要ですか？",
      answer: "ほぼ不要です。予約確認も会員証の処理もLINEの画面を見るだけ。導入時に簡単な説明動画もご提供します。",
    },
    {
      question: "お客様の個人情報は安全ですか？",
      answer: "はい、LINE公式アカウントのセキュリティ基準に準拠し、SSL暗号化通信で保護されています。",
    },
  ];

  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section className="py-20 px-4 bg-gray-50">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            よくある質問
          </h2>
          <p className="text-lg text-gray-600">
            導入前の不安を解消します
          </p>
        </div>
        <div className="space-y-4">
          {faqs.map((faq, index) => (
            <div
              key={index}
              className="bg-white rounded-2xl shadow-sm overflow-hidden border border-gray-100 hover:shadow-md transition-shadow"
            >
              <button
                onClick={() => setOpenIndex(openIndex === index ? null : index)}
                className="w-full px-6 py-5 text-left flex justify-between items-center hover:bg-gray-50 transition-colors"
              >
                <span className="font-semibold text-lg pr-4">{faq.question}</span>
                <span className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                  openIndex === index ? 'bg-emerald-500 text-white rotate-180' : 'bg-gray-100 text-gray-600'
                }`}>
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </span>
              </button>
              <div className={`transition-all duration-300 ${
                openIndex === index ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
              } overflow-hidden`}>
                <div className="px-6 pb-5">
                  <p className="text-gray-600 leading-relaxed">{faq.answer}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-12 text-center">
          <p className="text-gray-600 mb-4">
            その他のご質問も、お気軽にお問い合わせください
          </p>
          <a
            href="#demo"
            className="inline-block bg-emerald-500 text-white px-8 py-4 rounded-2xl hover:bg-emerald-600 transition-all transform hover:scale-105 font-semibold shadow-lg hover:shadow-xl"
          >
            無料相談で質問する
          </a>
        </div>
      </div>
    </section>
  );
}