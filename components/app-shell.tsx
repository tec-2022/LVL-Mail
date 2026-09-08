import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Icon } from "@/components/icons";
import { canAccessApp, getPagePrincipal, hasPermission, type Permission } from "@/lib/iam";

const nav: ReadonlyArray<readonly [string, string, string, Permission]> = [
  ["/", "Resumen", "grid", "platform.read"],
  ["/apps", "Aplicaciones", "apps", "apps.read"],
  ["/templates", "Plantillas", "template", "templates.read"],
  ["/activity", "Actividad", "activity", "messages.read"],
  ["/reputation", "Reputación", "shield", "reputation.read"],
  ["/operations", "Operaciones", "activity", "incidents.read"],
  ["/alerts", "Alertas", "shield", "incidents.read"],
  ["/team", "Equipo", "apps", "team.read"],
  ["/settings", "Configuración", "settings", "security.manage"],
];

function initials(value: string) {
  return value.split(/\s+|@/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "LT";
}

export async function AppShell({ active, children, requiredPermission, appId }: { active: string; children: ReactNode; requiredPermission?: Permission; appId?: string | null }) {
  const principal = await getPagePrincipal();
  if (!principal) redirect("/login?error=access");
  if (requiredPermission && !hasPermission(principal.role, requiredPermission)) redirect("/");
  if (appId && !canAccessApp(principal, appId)) redirect("/apps");

  const providerReady = Boolean(process.env.RESEND_API_KEY);
  const providerName = (process.env.LVL_MAIL_PROVIDER ?? "resend").toLowerCase();
  const visibleNav = nav.filter(([, , , permission]) => hasPermission(principal.role, permission));

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><Icon name="mail" width="22" height="22" /></div>
          <div><strong>LVL Mail</strong><span>Control plane</span></div>
        </div>
        <nav className="nav-list" aria-label="Principal">
          {visibleNav.map(([href, label, icon]) => (
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
          <div className="topbar-actions">
            <span className={providerReady ? "pill success" : "pill neutral"}>{providerReady ? `${providerName} conectado` : `${providerName} pendiente`}</span>
            <div className="staff-chip"><div className="avatar">{initials(principal.displayName)}</div><div><strong>{principal.displayName}</strong><span>{principal.kind === "break_glass" ? "break-glass owner" : principal.role}</span></div></div>
            {principal.kind === "staff" && <form action="/api/auth/logout" method="post"><button className="logout-button" type="submit">Salir</button></form>}
          </div>
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
