"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function FeaturesContent() {
  const searchParams = useSearchParams();
  const seg = searchParams.get("seg") || "beauty";

  const segmentFeatures = {
    beauty: [
      {
        title: "予約/順番待ち",
        points: ["メニュー/スタッフ/所要時間/枠の設定", "当日受付・呼び出し通知", "スタッフ指名・メモ"],
      },
      {
        title: "会員証",
        points: ["スタンプ・ポイント・回数券", "QR提示で消化", "再来クーポン自動配布"],
      },
      {
        title: "多言語",
        points: ["英/中/韓のテンプレ内蔵", "文言は店舗側で上書きOK"],
      },
      {
        title: "通知",
        points: ["確定/前日/直前/呼出", "来店後アンケを自動", "キャンセル時の自動再開放"],
      },
    ],
    seitai: [
      {
        title: "予約/順番待ち",
        points: ["初診/再診フロー対応", "施術時間の自動計算", "問診票の事前送信"],
      },
      {
        title: "会員証",
        points: ["回数券・定期券管理", "来院履歴の確認", "次回予約の促進"],
      },
      {
        title: "多言語",
        points: ["英/中/韓のテンプレ内蔵", "医療用語の対訳付き"],
      },
      {
        title: "通知",
        points: ["施術前日のリマインド", "定期メンテナンスの案内", "健康情報の配信"],
      },
    ],
    food: [
      {
        title: "順番待ち特化",
        points: ["リアルタイム待ち組数表示", "人数・席タイプ選択", "呼び出し5分前通知"],
      },
      {
        title: "予約管理",
        points: ["時間帯・人数指定", "コース予約対応", "キャンセル待ち機能"],
      },
      {
        title: "多言語",
        points: ["英/中/韓のメニュー対応", "アレルギー情報の多言語化"],
      },
      {
        title: "通知",
        points: ["入店可能通知", "ラストオーダー案内", "混雑状況のお知らせ"],
      },
    ],
  };

  const features = segmentFeatures[seg as keyof typeof segmentFeatures] || segmentFeatures.beauty;

  return (
    <section className="py-16 px-4 bg-gray-50">
      <div className="max-w-6xl mx-auto">
        <h2 className="text-3xl font-bold text-center mb-12">
          主な機能
        </h2>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((feature, index) => (
            <div
              key={index}
              className="bg-white p-6 rounded-xl shadow-sm hover:shadow-md transition-shadow"
            >
              <h3 className="text-lg font-bold mb-3">{feature.title}</h3>
              <ul className="space-y-2">
                {feature.points.map((point, idx) => (
                  <li key={idx} className="text-gray-700 text-sm flex items-start">
                    <span className="text-emerald-500 mr-2">•</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Features() {
  return (
    <Suspense fallback={<div className="py-16 px-4 bg-gray-50">Loading...</div>}>
      <FeaturesContent />
    </Suspense>
  );
}