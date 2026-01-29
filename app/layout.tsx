import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
    title: "智慧媽咪 AI Agent",
    description: "智慧媽咪 AI 助理系統",
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="zh-TW">
            <body>{children}</body>
        </html>
    );
}