import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app-shell";
import { listRegisteredApps } from "@/lib/app-registry";
import { evaluateReliability, getFleetReliability, listIncidents } from "@/lib/operations";
import { filterAppScoped, getPagePrincipal, scopeAppIds } from "@/lib/iam";

export const metadata = { title: "Operaciones" };

function pct(value: number | null, digits = 2) {
  return value == null ? "—" : `${Number(value).toFixed(digits)}%`;
}

function ms(value: number | null) {
  if (value == null) return "—";
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10000 ? 0 : 1)} s`;
  return `${Math.round(value)} ms`;
}

function date(value: string) {
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Tijuana",
  }).format(new Date(value));
}

function healthFor(row: Awaited<ReturnType<typeof getFleetReliability>>[number]) {
  if ((row.complaint_rate_24h ?? 0) >= 0.06 || (row.provider_reject_rate_1h ?? 0) >= 5 || (row.p0_delivery_rate_24h ?? 100) < 95) return "critical";
  if ((row.complaint_rate_24h ?? 0) >= 0.03 || (row.bounce_rate_24h ?? 0) >= 1 || (row.p0_accept_p95_ms ?? 0) > 2000 || (row.p0_delivery_rate_24h ?? 100) < 99) return "warning";
  return "healthy";
}

export default async function OperationsPage() {
  const principal = await getPagePrincipal();
  if (!principal) redirect("/login?error=access");
  const scope = scopeAppIds(principal);
  const apps = filterAppScoped(principal, await listRegisteredApps(), (app) => app.id);

  // A manual UI sweep only evaluates applications the current principal can see.
  await Promise.allSettled(apps.slice(0, 100).map((app) => evaluateReliability(app.id)));

  const [fleet, incidents] = await Promise.all([
    getFleetReliability(scope),
    listIncidents(100, scope),
  ]);

  const active = incidents.filter((incident) => incident.status !== "resolved");
  const critical = active.filter((incident) => incident.severity === "critical");
  const acknowledged = active.filter((incident) => incident.status === "acknowledged");
  const healthyApps = fleet.filter((row) => healthFor(row) === "healthy").length;
  const worstAccept = fleet.reduce<number | null>((max, row) => row.p0_accept_p95_ms == null ? max : max == null ? row.p0_accept_p95_ms : Math.max(max, row.p0_accept_p95_ms), null);
  const providerName = (process.env.LVL_MAIL_PROVIDER ?? "resend").toLowerCase();
  const providerIncident = active.some((incident) => incident.incident_type === "provider_rejections");

  return <AppShell active="Operaciones" requiredPermission="incidents.read">
    <PageHeader eyebrow="Operations & Reliability" title="Operaciones" description={principal.allApps ? "SLOs, incidentes y salud de entrega por aplicación." : "SLOs e incidentes exclusivamente para las aplicaciones de tu scope."} />

    <section className="ops-status-strip">
      <div className={`ops-system-state ${critical.length ? "critical" : active.length ? "warning" : "healthy"}`}>
        <span className="ops-pulse" />
        <div><span>{principal.allApps ? "ESTADO GLOBAL" : "ESTADO DE TU SCOPE"}</span><strong>{critical.length ? "Incidente crítico" : active.length ? "Degradación detectada" : "Operación normal"}</strong></div>
      </div>
      <div className="ops-provider-state"><span>PROVEEDOR ACTIVO</span><strong>{providerName}</strong><small>{providerIncident ? "Con señales de rechazo visibles" : "Sin incidente de rechazo visible"}</small></div>
    </section>

    <section className="metrics-grid ops-metrics">
      <article className="metric-card featured"><span>Incidentes activos</span><strong>{active.length}</strong><small>{critical.length} críticos · {acknowledged.length} reconocidos</small></article>
      <article className="metric-card"><span>Apps saludables</span><strong>{fleet.length ? `${healthyApps}/${fleet.length}` : "—"}</strong><small>Según SLOs y señales de 24 h</small></article>
      <article className="metric-card"><span>Peor aceptación P0 · P95</span><strong>{ms(worstAccept)}</strong><small>Objetivo operativo: ≤ 2 s</small></article>
      <article className="metric-card"><span>Scope</span><strong>{principal.allApps ? "Global" : apps.length}</strong><small>{principal.allApps ? "Toda la flota" : "Aplicaciones autorizadas"}</small></article>
    </section>

    <section className="panel ops-incidents-panel">
      <div className="panel-head"><div><span className="eyebrow">INCIDENT COMMAND CENTER</span><h2>Incidentes</h2></div><span className={active.length ? "pill warning" : "pill success"}>{active.length ? `${active.length} activos` : "Sin incidentes"}</span></div>
      {incidents.length === 0 ? <div className="empty-state"><h2>Sin incidentes visibles</h2><p>Cuando los SLOs de una aplicación dentro de tu scope crucen un umbral, aparecerá aquí.</p></div> : <div className="incident-list">
        {incidents.map((incident) => <Link href={`/operations/incidents/${incident.id}`} className={`incident-row ${incident.status === "resolved" ? "resolved" : incident.severity}`} key={incident.id}>
          <span className={`incident-severity ${incident.severity}`}>{incident.severity === "critical" ? "CRITICAL" : "WARNING"}</span>
          <div className="incident-main"><strong>{incident.title}</strong><span>{incident.summary}</span></div>
          <code>{incident.app_id}</code>
          <span className={`incident-status ${incident.status}`}>{incident.status === "open" ? "Abierto" : incident.status === "acknowledged" ? "Reconocido" : "Resuelto"}</span>
          <time dateTime={incident.last_detected_at}>{date(incident.last_detected_at)}</time>
          <span className="incident-arrow">→</span>
        </Link>)}
      </div>}
    </section>

    <section className="panel">
      <div className="panel-head"><div><span className="eyebrow">SLO FLEET VIEW</span><h2>Salud por aplicación</h2></div><span className="pill neutral">24 h / 1 h</span></div>
      {fleet.length === 0 ? <div className="empty-state"><h2>Sin SLOs visibles</h2><p>Las métricas aparecerán para las aplicaciones dentro de tu scope cuando exista actividad.</p></div> : <div className="slo-table">
        <div className="slo-row slo-head"><span>Aplicación</span><span>Estado</span><span>P0 entrega</span><span>P0 accept P95</span><span>P0 delivery P95</span><span>Reject 1h</span><span>Bounce</span><span>Complaint</span></div>
        {fleet.map((row) => { const health = healthFor(row); return <div className="slo-row" key={row.app_id}>
          <div><strong>{row.app_name}</strong><code>{row.app_id}</code></div>
          <span className={`slo-health ${health}`}>{health === "healthy" ? "Saludable" : health === "warning" ? "Atención" : "Crítico"}</span>
          <strong>{pct(row.p0_delivery_rate_24h, 1)}</strong>
          <span>{ms(row.p0_accept_p95_ms)}</span>
          <span>{ms(row.p0_delivery_p95_ms)}</span>
          <span>{pct(row.provider_reject_rate_1h)}</span>
          <span>{pct(row.bounce_rate_24h)}</span>
          <span>{pct(row.complaint_rate_24h, 3)}</span>
        </div>})}
      </div>}
    </section>

    <section className="ops-slo-explainer">
      <article><span>P0 ACCEPTANCE</span><strong>Objetivo P95 ≤ 2 s</strong><p>Desde que LVL Mail registra el correo hasta que el proveedor lo acepta.</p></article>
      <article><span>P0 DELIVERY</span><strong>Objetivo ≥ 99%</strong><p>Correos P0 aceptados que llegan a entrega.</p></article>
      <article><span>REPUTATION</span><strong>Guardrails por app</strong><p>Bounces y complaints restringen tráfico no crítico sin afectar otras aplicaciones.</p></article>
    </section>
  </AppShell>;
}
