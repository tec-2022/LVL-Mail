import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./onboarding.css";
import "./tracking.css";
import "./enterprise.css";
import "./template-studio.css";
import "./operations.css";
import "./search-recovery.css";
import "./iam.css";

export const metadata: Metadata = {
  title: { default: "LVL Mail", template: "%s · LVL Mail" },
  description: "Infraestructura central de correo para productos LVL Tech.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
