import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./onboarding.css";
import "./tracking.css";

export const metadata: Metadata = {
  title: { default: "LVL Mail", template: "%s · LVL Mail" },
  description: "Infraestructura central de correo para productos LVL Tech.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
