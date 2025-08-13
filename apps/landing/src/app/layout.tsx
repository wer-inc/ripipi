import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL('https://ripipi.com'),
  title: "Ripipi - LINEだけで予約・順番待ち・会員証 | 美容室・サロン向け",
  description: "前日・直前リマインドでノーショー削減率平均30%。美容室・ネイルサロン・整体院向けのLINE予約システム。最短3営業日で導入可能。",
  keywords: ["LINE予約", "美容室予約システム", "サロン予約", "ノーショー対策", "順番待ちシステム", "会員証アプリ"],
  openGraph: {
    title: "Ripipi - LINEだけで予約・順番待ち・会員証",
    description: "前日・直前リマインドでノーショー削減。美容室・サロン向けLINE予約システム",
    url: "https://ripipi.com",
    siteName: "Ripipi",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Ripipi - LINE予約システム",
      },
    ],
    locale: "ja_JP",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Ripipi - LINEだけで予約・順番待ち・会員証",
    description: "前日・直前リマインドでノーショー削減。美容室・サロン向けLINE予約システム",
    images: ["/og-image.png"],
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body className="antialiased">{children}</body>
    </html>
  );
}