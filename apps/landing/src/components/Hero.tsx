"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function HeroContent() {
  const searchParams = useSearchParams();
  const variant = searchParams.get("variant") || "a";
  const seg = searchParams.get("seg") || "beauty";

  const variants = {
    a: {
      title: "LINEだけで「予約・順番待ち・会員証」",
      sub: (
        <>
          前日・直前リマインドで<span className="font-bold text-gray-900">当日キャンセルを自動で減らす</span>。<br />
          最短3営業日で開始。
        </>
      ),
      ctaPrimary: "15分デモを予約",
      ctaSecondary: "デモQRで体験",
    },
    b: {
      title: "アプリ不要、今日から「LINE予約」",
      sub: (
        <>
          ノーショー▲30%・再来＋10%の仕組みを<span className="font-bold text-gray-900">1枚のQR</span>で。
        </>
      ),
      ctaPrimary: "QRを受け取る",
      ctaSecondary: "料金を見る",
    },
    c: {
      title: "予約管理、もうLINEだけでいい",
      sub: (
        <>
          会員証・回数券・多言語も、<span className="font-bold text-gray-900">お店の負担ゼロ</span>で。
        </>
      ),
      ctaPrimary: "無料相談（15分）",
      ctaSecondary: "デモを見る",
    },
  };

  const segments = {
    beauty: "美容室・サロン向け",
    seitai: "整体・治療院向け",
    food: "飲食・順番待ち向け",
  };

  const currentVariant = variants[variant as keyof typeof variants] || variants.a;
  const currentSegment = segments[seg as keyof typeof segments] || segments.beauty;

  return (
    <section className="pt-28 pb-16 px-4">
      <div className="max-w-4xl mx-auto text-center">
        <span className="inline-block px-4 py-1.5 bg-emerald-50 text-emerald-700 rounded-full text-sm font-medium mb-4">
          {currentSegment}
        </span>
        
        <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-6 leading-tight">
          {currentVariant.title}
        </h1>
        
        <p className="text-lg md:text-xl text-gray-600 mb-8">
          {currentVariant.sub}
        </p>
        
        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
          <a
            href="#demo"
            className="bg-emerald-500 text-white px-7 py-4 rounded-2xl hover:bg-emerald-600 transition-colors text-lg font-medium shadow-lg"
          >
            {currentVariant.ctaPrimary}
          </a>
          <a
            href="#qr"
            className="bg-white text-gray-700 border border-gray-300 px-7 py-4 rounded-2xl hover:bg-gray-50 transition-colors text-lg font-medium"
          >
            {currentVariant.ctaSecondary}
          </a>
        </div>

        <div id="qr" className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-8">
          <div className="inline-block p-4 bg-white rounded-xl shadow-sm">
            <div className="w-32 h-32 bg-gray-100 rounded-lg flex items-center justify-center">
              <span className="text-gray-400 text-sm">デモQR</span>
            </div>
          </div>
          <div className="text-left">
            <p className="font-medium">LINEで「Ripipi」を体験</p>
            <p className="text-sm text-gray-500">※本番では店舗ごとのLIFF起動URLに差し替え</p>
          </div>
        </div>

        <p className="text-gray-600">
          導入実績 <strong className="text-gray-900">50店舗</strong>｜
          平均ノーショー <strong className="text-gray-900">▲30%</strong>｜
          美容/サロン/整体 等
        </p>
      </div>
    </section>
  );
}

export default function Hero() {
  return (
    <Suspense fallback={<div className="pt-28 pb-16 px-4 text-center">Loading...</div>}>
      <HeroContent />
    </Suspense>
  );
}