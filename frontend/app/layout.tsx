import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";

export const metadata: Metadata = {
  title: "ShipMind",
  description: "PR / Issue intelligent collaboration agent for engineering teams"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-US">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
