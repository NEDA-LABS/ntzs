import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NeonAuthUIProvider } from "@neondatabase/neon-js/auth/react/ui";
import { authClient } from "@/lib/auth/client";
import "./globals.css";

const BASE_APP_ID = process.env.BASE_APP_ID;

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
  icons: {
    icon: "/ntzs-logo.png",
    apple: "/ntzs-logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {BASE_APP_ID && <meta name="base:app_id" content={BASE_APP_ID} />}
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <NeonAuthUIProvider authClient={authClient} redirectTo="/app">
          {children}
        </NeonAuthUIProvider>
      </body>
    </html>
  );
}
