import type { Metadata } from "next";

export const metadata: Metadata = { title: "กระเป๋า" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
