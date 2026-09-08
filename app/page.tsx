import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell, PageHeader, PriorityBadge } from "@/components/app-shell";
import { Icon } from "@/components/icons";
import { listRegisteredApps } from "@/lib/app-registry";
import { getDashboardMetrics } from "@/lib/supabase-rest";
import { listIncidents } from "@/lib/operations";
import { filterAppScoped, getPagePrincipal, hasPermission, scopeAppIds } from "@/lib/iam";

function percent(value: number | null) {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

export default async function Home() {
  const principal = await getPagePrincipal();
  if (!principal) redirect("/login?error=access");
  const scope = scopeAppIds(principal);
  const [metrics, allApps, incidents] = await Promise.all([
    getDashboardMetrics(scope),
    listRegisteredApps(),
    listIncidents(30, scope),
  ]);
  const apps = filterAppScoped(principal, allApps, (app) => app.id);
  const canManageApps = hasPermission(principal.role, "apps.manage");
  const deliveryRate = metrics && metrics.accepted > 0
    ? (metrics.delivered / metrics.accepted) * 100
    : null;
  const activeIncidents = incidents.filter((incident) => incident.status !== "resolved");
  const criticalIncidents = activeIncidents.filter((incident) => incident.severity === "critical");

  return (
    <AppShell active="Resumen" requiredPermission="platform.read">
      <PageHeader eyebrow={principal.allApps ? "Estado del sistema" : "Estado de tu scope"} title="Correo crítico, primero." description={principal.allApps ? "LVL Mail centraliza el envío de todas nuestras aplicaciones y reserva la vía rápida para confirmaciones, recuperación y OTP." : `Tu dashboard está aislado a ${apps.length} aplicación${apps.length === 1 ? "" : "es"} autorizada${apps.length === 1 ? "" : "s"}.`} action={canManageApps ? <Link className="button" href="/apps/new">Agregar web <Icon name="arrow" width="16" height="16" /></Link> : undefined} />
      <section className="metrics-grid">
        <article className="metric-card featured"><div className="metric-icon"><Icon name="bolt" width="20" height="20" /></div><span>Vía crítica P0</span><strong>Activa</strong><small>Sin batching para autenticación</small></article>
        <article className="metric-card"><span>Aceptados · 24 h</span><strong>{metrics?.accepted ?? "—"}</strong><small>{metrics ? `${metrics.bounced} rebotes · ${metrics.complained} complaints` : "Disponible al conectar Supabase + webhook"}</small></article>
        <article className="metric-card"><span>Entregabilidad · 24 h</span><strong>{percent(deliveryRate)}</strong><small>{metrics ? `${metrics.delivered} entregados · ${metrics.suppressed} suprimidos` : "Sin datos inventados"}</small></article>
        <article className="metric-card"><span>{principal.allApps ? "Dominio de envío" : "Apps visibles"}</span><strong className={principal.allApps ? "metric-domain" : undefined}>{principal.allApps ? "mail.lvltechmx.com" : apps.length}</strong><small>{principal.allApps ? `${apps.length} identidades registradas` : "Scope aplicado a todas las métricas"}</small></article>
      </section>

      {activeIncidents.length > 0 ? <section className={criticalIncidents.length ? "control-alert error" : "platform-notice"}><strong>{criticalIncidents.length ? `${criticalIncidents.length} incidente${criticalIncidents.length === 1 ? " crítico" : "s críticos"}` : `${activeIncidents.length} señal${activeIncidents.length === 1 ? " requiere" : "es requieren"} atención`}</strong><span>Operations & Reliability detectó degradación dentro de tu scope. <Link className="text-link" href="/operations">Abrir centro de incidentes →</Link></span></section> : <section className="platform-notice"><strong>Operations & Reliability</strong><span>Sin incidentes activos visibles. SLOs P0, proveedor y reputación siguen evaluándose por aplicación.</span></section>}

      <section className="two-col">
        <article className="panel">
          <div className="panel-head"><div><span className="eyebrow">PRIORITY ENGINE</span><h2>Orden de entrega</h2></div><span className="pill success">Política activa</span></div>
          <div className="lane-list">
            <div className="lane critical"><PriorityBadge priority="P0"/><div><strong>Seguridad y acceso</strong><span>Confirmación de correo · recuperación · OTP</span></div><span className="lane-mode">Directo</span></div>
            <div className="lane"><PriorityBadge priority="P1"/><div><strong>Transaccional</strong><span>Pedidos · facturas · reservas · invitaciones</span></div><span className="lane-mode">Alta</span></div>
            <div className="lane"><PriorityBadge priority="P2"/><div><strong>Notificaciones</strong><span>Reportes · avisos · resúmenes</span></div><span className="lane-mode">Normal</span></div>
            <div className="lane muted"><PriorityBadge priority="P3"/><div><strong>Marketing</strong><span>Bloqueado hasta habilitar consentimiento y controles adicionales</span></div><span className="lane-mode">Protegido</span></div>
          </div>
        </article>

        <article className="panel">
          <div className="panel-head"><div><span className="eyebrow">REPUTACIÓN</span><h2>Guardrails</h2></div></div>
          <div className="guardrails">
            <div><Icon name="check" width="18" height="18"/><span><strong>Prioridad impuesta por servidor</strong><small>Una app no puede autodeclararse P0.</small></span></div>
            <div><Icon name="check" width="18" height="18"/><span><strong>Idempotencia obligatoria</strong><small>Previene duplicados en reintentos.</small></span></div>
            <div><Icon name="check" width="18" height="18"/><span><strong>Supresión antes del envío</strong><small>Hard bounces y complaints dejan de recibir correo.</small></span></div>
            <div><Icon name="check" width="18" height="18"/><span><strong>Scope server-side</strong><small>Las métricas y consultas respetan la membresía del operador.</small></span></div>
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="panel-head"><div><span className="eyebrow">APLICACIONES</span><h2>Identidades de correo</h2></div><Link href="/apps" className="text-link">Abrir aplicaciones →</Link></div>
        {apps.length === 0 ? <div className="empty-state"><h2>Sin aplicaciones asignadas</h2><p>Un Owner puede asignarte scope desde Equipo.</p></div> : <div className="app-table">
          {apps.map((app) => <div className="app-row" key={app.id}><div className="app-logo" style={{ background: app.surface, color: app.accent }}>{app.name.slice(0,2).toUpperCase()}</div><div className="app-name"><strong>{app.name}</strong><span>{app.tagline}</span></div><code>{app.senderLocalPart}@mail.lvltechmx.com</code><span className={app.isEnabled ? "pill success" : "pill neutral"}>{app.isEnabled ? "Activa" : "Pausada"}</span></div>)}
        </div>}
      </section>
    </AppShell>
  );
}
