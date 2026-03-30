import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SimpleFX — The Open TZS Liquidity Market",
  description:
    "Provide nTZS liquidity. Set your spread. Earn fees on every swap filled — automatically.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
