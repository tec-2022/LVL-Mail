import type { ReactNode } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons";

const nav = [
  ["/", "Resumen", "grid"],
  ["/apps", "Aplicaciones", "apps"],
  ["/templates", "Plantillas", "template"],
  ["/activity", "Actividad", "activity"],
  ["/reputation", "Reputación", "shield"],
  ["/settings", "Configuración", "settings"],
] as const;

export function AppShell({ active, children }: { active: string; children: ReactNode }) {
  const providerReady = Boolean(process.env.RESEND_API_KEY);
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><Icon name="mail" width="22" height="22" /></div>
          <div><strong>LVL Mail</strong><span>Control plane</span></div>
        </div>
        <nav className="nav-list" aria-label="Principal">
          {nav.map(([href, label, icon]) => (
            <Link key={href} href={href} className={label === active ? "nav-item active" : "nav-item"}>
              <Icon name={icon} width="18" height="18" /><span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="domain-chip"><span className="status-dot" />mail.lvltechmx.com</div>
          <p>Gateway central de correo de LVL Tech.</p>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div><span className="eyebrow">LVL TECH / EMAIL INFRASTRUCTURE</span></div>
          <div className="topbar-actions"><span className={providerReady ? "pill success" : "pill neutral"}>{providerReady ? "Resend conectado" : "Resend pendiente"}</span><div className="avatar">LT</div></div>
        </header>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action && <div>{action}</div>}</div>;
}

export function PriorityBadge({ priority }: { priority: "P0" | "P1" | "P2" | "P3" }) {
  return <span className={`priority ${priority.toLowerCase()}`}>{priority}</span>;
}
