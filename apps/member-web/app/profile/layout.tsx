import type { Metadata } from "next";

export const metadata: Metadata = { title: "ข้อมูลสมาชิก" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
