import type { Metadata } from "next";

export const metadata: Metadata = { title: "อ่านก่อนใช้บริการ" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
