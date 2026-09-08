import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app-shell";
import { resolveRegisteredApp } from "@/lib/app-registry";
import { getTrackedMessage, getTrackedMessageEvents } from "@/lib/mail-tracking";

export const metadata = { title: "Detalle de correo" };

const eventLabels: Record<string, string> = {
  "email.sent": "Enviado por el proveedor",
  "email.delivered": "Entregado al destinatario",
  "email.delivery_delayed": "Entrega retrasada",
  "email.bounced": "Correo rebotado",
  "email.complained": "Marcado como spam",
  "email.failed": "Entrega fallida",
  "email.suppressed": "Suprimido por el proveedor",
  "email.opened": "Correo abierto",
  "email.clicked": "Enlace abierto",
};

const statusLabels: Record<string, string> = {
  processing: "Procesando",
  blocked: "Bloqueado",
  provider_rejected: "Rechazado",
  accepted: "Aceptado",
  sent: "Enviado",
  delayed: "Retrasado",
  delivered: "Entregado",
  bounced: "Rebotado",
  complained: "Complaint",
  failed: "Fallido",
  suppressed: "Suprimido",
};

function date(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-MX", { dateStyle:"medium", timeStyle:"medium", timeZone:"America/Tijuana" }).format(new Date(value));
}

function templateVersionLabel(source: string, version: number | null) {
  if (source === "published" && version) return `Publicada · v${version}`;
  if (source === "studio_test") return "Template Studio · prueba";
  return "Plantilla base LVL Mail";
}

export default async function MessageTrackingPage({ params }: { params: Promise<{ messageId: string }> }) {
  const { messageId } = await params;
  const message = await getTrackedMessage(messageId);
  if (!message) notFound();

  const [events, app] = await Promise.all([
    getTrackedMessageEvents(message.id),
    resolveRegisteredApp(message.app_id),
  ]);

  return <AppShell active="Actividad"><PageHeader eyebrow="Correo trackeado" title={statusLabels[message.status] ?? message.status} description={`Trazabilidad completa de un correo de ${app?.name ?? message.app_id}.`} action={<Link className="secondary-button" href={`/apps/${message.app_id}`}>Ver aplicación →</Link>} />
    <section className="two-col">
      <article className="panel"><div className="panel-head"><div><span className="eyebrow">IDENTIDAD</span><h2>Datos del correo</h2></div><span className={`status-badge ${message.status}`}>{statusLabels[message.status] ?? message.status}</span></div><dl className="tracking-meta"><div><dt>Aplicación</dt><dd>{app?.name ?? message.app_id}</dd></div><div><dt>Tracking ID</dt><dd><code className="tracking-id">{message.id}</code></dd></div><div><dt>Plantilla</dt><dd><code>{message.template_key}</code></dd></div><div><dt>Versión</dt><dd>{templateVersionLabel(message.template_source, message.template_version)}</dd></div><div><dt>Prioridad</dt><dd>{message.priority}</dd></div><div><dt>Solicitado</dt><dd>{date(message.created_at)}</dd></div><div><dt>Aceptado</dt><dd>{date(message.accepted_at)}</dd></div><div><dt>Entregado</dt><dd>{date(message.delivered_at)}</dd></div><div><dt>Proveedor ID</dt><dd><code>{message.provider_id ?? "—"}</code></dd></div>{message.failure_code && <div><dt>Motivo</dt><dd>{message.failure_code}</dd></div>}</dl></article>
      <article className="panel"><div className="panel-head"><div><span className="eyebrow">PRIVACIDAD</span><h2>Destinatario protegido</h2></div></div><p style={{fontSize:"12px",color:"#64748b",lineHeight:1.7}}>LVL Mail no necesita mostrar la dirección completa para auditar el flujo. El destinatario se identifica internamente mediante hash.</p><code className="tracking-id">{message.recipient_hash}</code></article>
    </section>

    <section className="panel"><div className="panel-head"><div><span className="eyebrow">TIMELINE</span><h2>Eventos del correo</h2></div><span className="pill neutral">{events.length} eventos</span></div><div className="timeline"><div className="timeline-event"><div className="timeline-dot">1</div><div><strong>Solicitud recibida por LVL Mail</strong><small>Asignada a {app?.name ?? message.app_id} con {templateVersionLabel(message.template_source, message.template_version)} antes de contactar al proveedor.</small></div><time dateTime={message.created_at}>{date(message.created_at)}</time></div>{events.map((event, index) => <div className="timeline-event" key={event.provider_event_id}><div className="timeline-dot">{index + 2}</div><div><strong>{eventLabels[event.event_type] ?? event.event_type}</strong><small>{event.event_type}</small></div><time dateTime={event.occurred_at}>{date(event.occurred_at)}</time></div>)}</div></section>
  </AppShell>;
}
