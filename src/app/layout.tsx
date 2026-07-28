import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Baloo_2 } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Bold, rounded display face for headings/CTAs — matches the logo's
// wordmark weight and the energetic, kid/team-fundraiser tone the brand
// is going for. Kept separate from Geist (body copy) so dense UI (tables,
// timestamps) stays legible.
const baloo = Baloo_2({
  variable: "--font-baloo",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

export const metadata: Metadata = {
  title: "FundRally",
  description: "Fundraising + fun. All in one.",
  appleWebApp: {
    title: "FundRally",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#fa7800",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${baloo.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
