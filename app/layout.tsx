import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CloseMate — Finance close, with evidence",
  description: "AI-assisted invoice reconciliation with traceable decisions and human review."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
