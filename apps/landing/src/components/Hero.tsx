"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { QRCodeSVG } from "qrcode.react";

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
    <section className="relative pt-32 pb-20 px-4 overflow-hidden">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-emerald-50/30 to-white -z-10" />
      
      {/* Decorative elements */}
      <div className="absolute top-20 right-10 w-72 h-72 bg-emerald-100/20 rounded-full blur-3xl -z-10 animate-pulse" />
      <div className="absolute bottom-0 left-10 w-96 h-96 bg-blue-100/20 rounded-full blur-3xl -z-10 animate-pulse" />
      
      <div className="max-w-5xl mx-auto text-center">
        <span className="inline-block px-5 py-2 bg-emerald-50 text-emerald-700 rounded-full text-sm font-semibold mb-6 animate-fade-in">
          {currentSegment}
        </span>
        
        <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6 leading-tight text-gray-900 animate-fade-in-up animation-delay-100">
          {currentVariant.title}
        </h1>
        
        <p className="text-xl md:text-2xl text-gray-600 mb-10 max-w-3xl mx-auto animate-fade-in-up animation-delay-200">
          {currentVariant.sub}
        </p>
        
        <div className="flex flex-col sm:flex-row gap-4 justify-center mb-12 animate-fade-in-up animation-delay-300">
          <a
            href="#demo"
            className="bg-emerald-500 text-white px-8 py-4 rounded-2xl hover:bg-emerald-600 transition-all transform hover:scale-105 text-lg font-semibold shadow-xl hover:shadow-2xl"
          >
            {currentVariant.ctaPrimary}
          </a>
          <a
            href="#qr"
            className="bg-white text-gray-700 border-2 border-gray-200 px-8 py-4 rounded-2xl hover:border-emerald-300 hover:bg-emerald-50 transition-all transform hover:scale-105 text-lg font-semibold"
          >
            {currentVariant.ctaSecondary}
          </a>
        </div>

        <div id="qr" className="flex flex-col sm:flex-row items-center justify-center gap-6 mb-12 animate-fade-in-up animation-delay-400">
          <div className="relative group">
            <div className="absolute inset-0 bg-emerald-400/20 rounded-2xl blur-xl group-hover:bg-emerald-400/30 transition-all" />
            <div className="relative p-6 bg-white rounded-2xl shadow-xl border border-gray-100">
              <div className="w-36 h-36 bg-white rounded-xl flex items-center justify-center relative overflow-hidden p-2">
                <QRCodeSVG 
                  value="https://liff.line.me/2007919613-YrjmyLL9" 
                  size={120}
                  level="M"
                  includeMargin={false}
                />
              </div>
            </div>
          </div>
          <div className="text-left">
            <p className="font-bold text-lg mb-1">LINEで「Ripipi」を体験</p>
            <p className="text-sm text-gray-500">スマホでQRを読み取るだけで即体験可能</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-6 text-sm md:text-base animate-fade-in-up animation-delay-500">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            <span className="text-gray-600">導入実績 <strong className="text-gray-900">50店舗以上</strong></span>
          </div>
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M12 7a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0V8.414l-4.293 4.293a1 1 0 01-1.414 0L8 10.414l-4.293 4.293a1 1 0 01-1.414-1.414l5-5a1 1 0 011.414 0L11 10.586 14.586 7H12z" clipRule="evenodd" />
            </svg>
            <span className="text-gray-600">平均ノーショー <strong className="text-gray-900">▲30%削減</strong></span>
          </div>
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-emerald-500" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
            </svg>
            <span className="text-gray-600">美容・サロン・整体で実績多数</span>
          </div>
        </div>
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