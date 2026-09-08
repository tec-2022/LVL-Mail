import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "LVL Mail", template: "%s · LVL Mail" },
  description: "Infraestructura central de correo para productos LVL Tech.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
