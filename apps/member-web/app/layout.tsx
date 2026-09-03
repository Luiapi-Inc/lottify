import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = { title: "Lottify", description: "Lottify Member App" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
