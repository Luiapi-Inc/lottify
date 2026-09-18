import type { Metadata } from "next";
import { AppChrome } from "./components/app-chrome";
import "./styles.css";
import "./redesign.css";

export const metadata: Metadata = {
  title: { default: "หน้าแรก | Lottify", template: "%s | Lottify" },
  description: "พื้นที่สมาชิก Lottify — หน้าแรก ซื้อหวย โพยของฉัน กระเป๋า และบัญชี",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="th"><body><AppChrome>{children}</AppChrome></body></html>;
}
