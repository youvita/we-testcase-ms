import type { Metadata, Viewport } from "next";

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "TestCase MS",
    template: "%s · TestCase MS",
  },
  description:
    "Online test case management — import Excel test cases, execute them online and track progress in real time.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

/**
 * Uses Tailwind's system font stack rather than next/font/google so builds and
 * deploys never depend on fetching a font at build time.
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        {/* Radix tooltips need a provider ancestor; one at the root keeps the
            open/close delay consistent wherever a tooltip is used. */}
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
        <Toaster />
      </body>
    </html>
  );
}
