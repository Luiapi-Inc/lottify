import type { Metadata } from "next";

export const metadata: Metadata = { title: "เข้าสู่ระบบ" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
