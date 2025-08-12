import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ripipi - LINEだけで予約・順番待ち・会員証 | 美容室・サロン向け",
  description: "前日・直前リマインドでノーショー削減。美容室・ネイルサロン・整体院向けのLINE予約システム。",
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