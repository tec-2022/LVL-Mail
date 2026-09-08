import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app-shell";
import { AlertingCenter } from "@/components/alerting-center";
import { listRegisteredApps } from "@/lib/app-registry";
import {
  alertEncryptionConfigured,
  listAlertChannels,
  listAlertDeliveries,
  listAlertEvents,
  listAlertRules,
} from "@/lib/alerting";
import { filterAppScoped, getPagePrincipal, hasPermission, scopeAppIds } from "@/lib/iam";

export const metadata = { title: "Alertas" };

function date(value: string) {
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Tijuana",
  }).format(new Date(value));
}

export default async function AlertsPage() {
  const principal = await getPagePrincipal();
  if (!principal) redirect("/login?error=access");
  const scope = scopeAppIds(principal);
  const apps = filterAppScoped(principal, await listRegisteredApps(), (app) => app.id);
  const canManage = hasPermission(principal.role, "apps.manage");

  const [events, channels, rules, deliveries] = await Promise.all([
    listAlertEvents(150, scope),
    canManage ? listAlertChannels() : Promise.resolve([]),
    canManage ? listAlertRules() : Promise.resolve([]),
    canManage ? listAlertDeliveries(100) : Promise.resolve([]),
  ]);

  const criticalVisible = events.filter((event) => event.severity === "critical");
  const recoveredVisible = events.filter((event) => event.event_type === "recovered" || event.event_type === "resolved");

  return <AppShell active="Alertas" requiredPermission="incidents.read">
    <PageHeader eyebrow="Alerting & Notification Center" title="Alertas" description={principal.allApps ? "Incidentes importantes, enrutamiento y estado de entrega de alertas para toda la flota." : "Alertas únicamente para las aplicaciones dentro de tu scope."} action={<Link className="secondary-button" href="/operations">Ver operaciones →</Link>} />

    <section className="metrics-grid">
      <article className="metric-card featured"><span>Eventos visibles</span><strong>{events.length}</strong><small>Últimas transiciones persistentes cargadas</small></article>
      <article className="metric-card"><span>Críticos visibles</span><strong>{criticalVisible.length}</strong><small>Eventos abiertos o escalados con severidad crítica</small></article>
      <article className="metric-card"><span>Recuperaciones visibles</span><strong>{recoveredVisible.length}</strong><small>Señales recuperadas o resueltas</small></article>
      <article className="metric-card"><span>Scope</span><strong>{principal.allApps ? "Global" : apps.length}</strong><small>{principal.allApps ? "Todas las aplicaciones" : "Apps autorizadas"}</small></article>
    </section>

    <section className="platform-notice"><strong>In-app siempre disponible</strong><span>El centro de alertas no depende del mismo proveedor de correo que está vigilando. Los webhooks externos son opcionales, firmados y reintentables. Las métricas de ventana temporal/SLO siguen viviendo en Operaciones.</span></section>

    <section className="panel"><div className="panel-head"><div><span className="eyebrow">ALERT INBOX</span><h2>Actividad reciente</h2></div><span className="pill neutral">{events.length}</span></div>
      {events.length === 0 ? <div className="empty-state"><h2>Sin alertas visibles</h2><p>Los eventos aparecerán aquí cuando un incidente se abra, escale o se recupere.</p></div> : <div className="incident-list">{events.map((event) => <Link href={`/operations/incidents/${event.incident_id}`} className={`incident-row ${event.event_type === "recovered" || event.event_type === "resolved" ? "resolved" : event.severity}`} key={event.id}><span className={`incident-severity ${event.severity}`}>{event.severity === "critical" ? "CRITICAL" : "WARNING"}</span><div className="incident-main"><strong>{event.title}</strong><span>{event.summary}</span></div><code>{event.app_id}</code><span className={`incident-status ${event.event_type === "recovered" || event.event_type === "resolved" ? "resolved" : "open"}`}>{event.event_type}</span><time dateTime={event.created_at}>{date(event.created_at)}</time><span className="incident-arrow">→</span></Link>)}</div>}
    </section>

    <AlertingCenter
      apps={apps.map((app) => ({ id: app.id, name: app.name }))}
      initialChannels={channels}
      initialRules={rules}
      recentDeliveries={deliveries}
      canManage={canManage}
      encryptionReady={alertEncryptionConfigured()}
    />
  </AppShell>;
}
