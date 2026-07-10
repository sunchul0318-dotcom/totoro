import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "판교 퀘스트 · Pangyo Quest",
  description:
    "지하철 판교역에서 위메이드플레이까지 — 출근길 빌런을 무찌르는 드래곤 퀘스트풍 실시간 액션 RPG",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#05060f",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
