import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NeonAuthUIProvider, UserButton } from "@neondatabase/neon-js/auth/react/ui";

import { authClient } from "@/lib/auth/client";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "nTZS",
  description: "nTZS issuance portal",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <NeonAuthUIProvider authClient={authClient} redirectTo="/app">
          <header className="flex h-16 items-center justify-end gap-4 p-4">
            <UserButton size="icon" />
          </header>
          {children}
        </NeonAuthUIProvider>
      </body>
    </html>
  );
}
