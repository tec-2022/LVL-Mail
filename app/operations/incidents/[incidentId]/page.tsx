import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app-shell";
import { IncidentActions } from "@/components/incident-actions";
import { resolveRegisteredApp } from "@/lib/app-registry";
import { getIncident, listIncidentEvents } from "@/lib/operations";
import { getPagePrincipal, hasPermission } from "@/lib/iam";

export const metadata = { title: "Incidente" };

function date(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "America/Tijuana",
  }).format(new Date(value));
}

const eventLabels: Record<string, string> = {
  opened: "Incidente abierto",
  severity_changed: "Severidad actualizada",
  acknowledged: "Incidente reconocido",
  recovered: "Señal recuperada automáticamente",
  resolved: "Incidente resuelto manualmente",
  note: "Nota",
};

export default async function IncidentPage({ params }: { params: Promise<{ incidentId: string }> }) {
  const { incidentId } = await params;
  const incident = await getIncident(incidentId);
  if (!incident) notFound();
  const principal = await getPagePrincipal();
  const canManage = Boolean(principal && hasPermission(principal.role, "incidents.manage"));
  const [events, app] = await Promise.all([
    listIncidentEvents(incident.id),
    resolveRegisteredApp(incident.app_id),
  ]);

  return <AppShell active="Operaciones" requiredPermission="incidents.read" appId={incident.app_id}>
    <PageHeader eyebrow="Incident command center" title={incident.title} description={`${app?.name ?? incident.app_id} · ${incident.summary}`} action={<Link className="secondary-button" href="/operations">← Operaciones</Link>} />

    <section className={`incident-hero ${incident.severity} ${incident.status}`}>
      <div><span className={`incident-severity ${incident.severity}`}>{incident.severity.toUpperCase()}</span><h2>{incident.status === "open" ? "Incidente activo" : incident.status === "acknowledged" ? "En investigación" : "Resuelto"}</h2><p>{incident.summary}</p></div>
      {canManage ? <IncidentActions incidentId={incident.id} status={incident.status} /> : <span className="pill neutral">Solo lectura</span>}
    </section>

    <section className="two-col">
      <article className="panel"><div className="panel-head"><div><span className="eyebrow">CONTEXTO</span><h2>Identidad</h2></div></div><dl className="tracking-meta"><div><dt>Aplicación</dt><dd>{app?.name ?? incident.app_id}</dd></div><div><dt>App ID</dt><dd><code>{incident.app_id}</code></dd></div><div><dt>Tipo</dt><dd><code>{incident.incident_type}</code></dd></div><div><dt>Proveedor</dt><dd>{incident.provider_name ?? "No atribuido"}</dd></div><div><dt>Detectado</dt><dd>{date(incident.first_detected_at)}</dd></div><div><dt>Última señal</dt><dd>{date(incident.last_detected_at)}</dd></div><div><dt>Reconocido</dt><dd>{date(incident.acknowledged_at)}</dd></div><div><dt>Resuelto</dt><dd>{date(incident.resolved_at)}</dd></div></dl></article>
      <article className="panel"><div className="panel-head"><div><span className="eyebrow">SIGNAL SNAPSHOT</span><h2>Métricas del incidente</h2></div></div>{Object.keys(incident.metrics).length === 0 ? <p className="help-text">Sin snapshot de métricas.</p> : <div className="incident-metrics">{Object.entries(incident.metrics).map(([key,value]) => <div key={key}><span>{key}</span><strong>{String(value)}</strong></div>)}</div>}</article>
    </section>

    <section className="panel"><div className="panel-head"><div><span className="eyebrow">INCIDENT TIMELINE</span><h2>Historial</h2></div><span className="pill neutral">{events.length} eventos</span></div>
      <div className="timeline">{events.map((event,index) => <div className="timeline-event" key={event.id}><div className="timeline-dot">{index + 1}</div><div><strong>{eventLabels[event.event_type] ?? event.event_type}</strong><small>{event.actor} · {Object.keys(event.details).length ? JSON.stringify(event.details) : "sin detalle adicional"}</small></div><time dateTime={event.created_at}>{date(event.created_at)}</time></div>)}</div>
    </section>
  </AppShell>;
}
