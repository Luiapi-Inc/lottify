import type { Metadata } from "next";

export const metadata: Metadata = { title: "ตั้งค่าหวย" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
