import type { Metadata } from "next";

export const metadata: Metadata = { title: "ลืมรหัสผ่าน" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
