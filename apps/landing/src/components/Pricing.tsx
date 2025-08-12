"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function PricingContent() {
  const searchParams = useSearchParams();
  const showPricing = searchParams.get("showPricing") !== "false";

  const plans = [
    {
      name: "ライト",
      price: "15,000",
      features: ["予約・通知（確定/前日/直前）", "基本的な管理機能", "月間予約数 200件まで"],
      recommended: false,
    },
    {
      name: "スタンダード",
      price: "22,000",
      features: ["ライト＋会員証/回数券", "多言語対応（英/中/韓）", "詳細分析レポート", "月間予約数 無制限"],
      recommended: true,
    },
    {
      name: "プロ",
      price: "30,000",
      features: ["スタンダード＋事前決済", "キャンセル料徴収", "優先サポート", "API連携"],
      recommended: false,
    },
  ];

  if (!showPricing) {
    return (
      <section className="py-16 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-4">料金について</h2>
          <p className="text-lg text-gray-600 mb-8">
            店舗規模や必要機能に応じて、最適なプランをご提案します
          </p>
          <a
            href="#demo"
            className="inline-block bg-emerald-500 text-white px-8 py-4 rounded-2xl hover:bg-emerald-600 transition-colors font-medium text-lg"
          >
            料金の詳細を聞く
          </a>
        </div>
      </section>
    );
  }

  return (
    <section className="py-16 px-4">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl font-bold text-center mb-12">
          料金プラン
        </h2>
        <div className="grid md:grid-cols-3 gap-8 mb-8">
          {plans.map((plan, index) => (
            <div
              key={index}
              className={`bg-white p-8 rounded-xl shadow-sm border-2 transition-all ${
                plan.recommended 
                  ? "border-emerald-500 shadow-lg scale-105" 
                  : "border-gray-200 hover:border-gray-300"
              }`}
            >
              {plan.recommended && (
                <p className="text-emerald-600 font-medium text-sm mb-2">
                  人気No.1
                </p>
              )}
              <h3 className="text-2xl font-bold mb-2">{plan.name}</h3>
              <p className="text-4xl font-bold mb-6">
                ¥{plan.price}
                <span className="text-base font-normal text-gray-600">/月</span>
              </p>
              <ul className="space-y-3">
                {plan.features.map((feature, idx) => (
                  <li key={idx} className="text-gray-700 flex items-start">
                    <span className="text-emerald-500 mr-2 mt-0.5">✓</span>
                    <span className="text-sm">{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="text-center text-gray-600">
          <p className="mb-2">
            ※ 初期費用 50,000〜200,000円（設定代行/教育/素材整備）
          </p>
          <p className="text-sm">
            ※ 多店舗割引、年間契約割引あり
          </p>
        </div>
      </div>
    </section>
  );
}

export default function Pricing() {
  return (
    <Suspense fallback={<div className="py-16 px-4">Loading...</div>}>
      <PricingContent />
    </Suspense>
  );
}