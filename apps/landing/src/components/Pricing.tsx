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
    <section className="py-20 px-4 bg-gray-50">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">
            シンプルな料金体系
          </h2>
          <p className="text-lg text-gray-600">
            必要な機能に応じて、3つのプランからお選びいただけます
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-6 lg:gap-8 mb-12">
          {plans.map((plan, index) => (
            <div
              key={index}
              className={`relative bg-white p-8 rounded-2xl transition-all duration-300 ${
                plan.recommended 
                  ? "shadow-2xl scale-105 border-2 border-emerald-500" 
                  : "shadow-sm hover:shadow-lg border border-gray-200"
              }`}
            >
              {plan.recommended && (
                <div className="absolute -top-4 left-1/2 -translate-x-1/2">
                  <span className="bg-emerald-500 text-white px-4 py-1 rounded-full text-sm font-semibold">
                    おすすめ
                  </span>
                </div>
              )}
              <div className="text-center mb-6">
                <h3 className="text-2xl font-bold mb-2">{plan.name}</h3>
                <div className="flex items-baseline justify-center">
                  <span className="text-5xl font-bold text-gray-900">¥{plan.price}</span>
                  <span className="text-gray-600 ml-2">/月</span>
                </div>
              </div>
              <ul className="space-y-4 mb-8">
                {plan.features.map((feature, idx) => (
                  <li key={idx} className="flex items-start">
                    <svg className="w-5 h-5 text-emerald-500 mr-3 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    <span className="text-gray-700">{feature}</span>
                  </li>
                ))}
              </ul>
              <a
                href="#demo"
                className={`block text-center py-3 px-6 rounded-xl font-medium transition-all ${
                  plan.recommended
                    ? "bg-emerald-500 text-white hover:bg-emerald-600"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                このプランで始める
              </a>
            </div>
          ))}
        </div>
        <div className="bg-white rounded-2xl p-8 shadow-sm">
          <div className="grid md:grid-cols-2 gap-8">
            <div>
              <h4 className="font-bold text-lg mb-3">初期費用について</h4>
              <p className="text-gray-600 mb-2">
                50,000〜200,000円（店舗規模により変動）
              </p>
              <ul className="space-y-1 text-sm text-gray-600">
                <li>• 初期設定の完全代行</li>
                <li>• スタッフ向け研修実施</li>
                <li>• 販促物（QRコード等）作成</li>
              </ul>
            </div>
            <div>
              <h4 className="font-bold text-lg mb-3">お得な割引制度</h4>
              <ul className="space-y-2 text-gray-600">
                <li className="flex items-center">
                  <span className="text-emerald-500 mr-2">▼10%</span>
                  年間契約割引
                </li>
                <li className="flex items-center">
                  <span className="text-emerald-500 mr-2">▼15%</span>
                  3店舗以上の多店舗割引
                </li>
                <li className="flex items-center">
                  <span className="text-emerald-500 mr-2">▼20%</span>
                  パートナー紹介割引
                </li>
              </ul>
            </div>
          </div>
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