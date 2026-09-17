import type { Metadata } from "next";

export const metadata: Metadata = { title: "บัญชีพร้อมสำหรับอะไรบ้าง" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
