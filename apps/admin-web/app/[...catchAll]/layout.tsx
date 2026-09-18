import type { Metadata } from "next";

export const metadata: Metadata = { title: "ไม่พบหน้า" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
