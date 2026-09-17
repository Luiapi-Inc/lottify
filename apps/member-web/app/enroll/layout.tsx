import type { Metadata } from "next";

export const metadata: Metadata = { title: "ตั้งรหัสผ่านครั้งแรก" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
