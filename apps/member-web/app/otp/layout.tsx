import type { Metadata } from "next";

export const metadata: Metadata = { title: "ยืนยันว่าเป็นคุณ" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
