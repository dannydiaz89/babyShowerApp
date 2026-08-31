import type { Metadata } from "next";
import { Cormorant_Garamond, Inter } from "next/font/google";
import { getLocale, dictionaryFor, pick } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";
import "./globals.css";

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-cormorant",
});

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export async function generateMetadata(): Promise<Metadata> {
  const [settings, locale] = await Promise.all([getSettings(), getLocale()]);
  return {
    title: `${settings.babyName} — ${dictionaryFor(locale).invitation.title}`,
    description: pick(settings.tagline, locale),
    // The site is password-gated; there is no reason for it to be indexed.
    robots: { index: false, follow: false },
    /*
     * iOS Safari rewrites phone numbers, dates and addresses into links before
     * React hydrates, which changes attributes on server-rendered HTML and
     * trips a hydration mismatch. This invitation is nothing but dates,
     * an address and a phone number, so all of it is turned off.
     */
    formatDetection: {
      telephone: false,
      date: false,
      address: false,
      email: false,
    },
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();

  return (
    <html lang={locale} className={`${cormorant.variable} ${inter.variable}`}>
      <body className="bloom min-h-dvh">{children}</body>
    </html>
  );
}
