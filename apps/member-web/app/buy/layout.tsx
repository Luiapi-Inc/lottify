import type { Metadata } from "next";

export const metadata: Metadata = { title: "ซื้อหวย" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
