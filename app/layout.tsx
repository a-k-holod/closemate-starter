import type { Metadata } from "next";
import { messagesFor } from "@/lib/messages";
import "./globals.css";

const english = messagesFor("en");

export const metadata: Metadata = {
  title: english.meta.title,
  description: english.meta.description
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
