import "./globals.css";
import type { Metadata } from "next";
export const metadata: Metadata = { title: "CareFlow Practice", description: "Synthetic-data ambulatory practice management demo" };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
