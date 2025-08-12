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
  ];

  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <section className="py-16 px-4 bg-gray-50">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-3xl font-bold text-center mb-12">
          よくある質問
        </h2>
        <div className="space-y-4">
          {faqs.map((faq, index) => (
            <div
              key={index}
              className="bg-white rounded-lg shadow-sm overflow-hidden"
            >
              <button
                onClick={() => setOpenIndex(openIndex === index ? null : index)}
                className="w-full px-6 py-4 text-left flex justify-between items-center hover:bg-gray-50"
              >
                <span className="font-medium">{faq.question}</span>
                <span className="text-2xl">
                  {openIndex === index ? "−" : "+"}
                </span>
              </button>
              {openIndex === index && (
                <div className="px-6 pb-4">
                  <p className="text-gray-700">{faq.answer}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}