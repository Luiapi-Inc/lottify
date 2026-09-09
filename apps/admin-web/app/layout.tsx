import type { Metadata } from "next";
import "./styles.css";
import "./control-plane.css";

export const metadata: Metadata = { title: "Lottify Admin", description: "Lottify Admin Control Plane" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
