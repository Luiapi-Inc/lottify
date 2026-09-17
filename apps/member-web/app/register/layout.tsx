import type { Metadata } from "next";

export const metadata: Metadata = { title: "สร้างบัญชี" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
