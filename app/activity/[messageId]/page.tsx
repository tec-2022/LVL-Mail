import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app-shell";
import { RecoveryActions } from "@/components/recovery-actions";
import { resolveRegisteredApp } from "@/lib/app-registry";
import { getTrackedMessage, getTrackedMessageEvents } from "@/lib/mail-tracking";
import { diagnoseMessage, getReplayContext } from "@/lib/search-recovery";
import { getSafeReplayDecision } from "@/lib/replay-safety";
import { getProviderTopology } from "@/lib/mail-provider";
import { getPagePrincipal, hasPermission } from "@/lib/iam";

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

  const principal = await getPagePrincipal();
  const canReplay = Boolean(principal && hasPermission(principal.role, "messages.replay"));
  const [events, app, replayContext] = await Promise.all([
    getTrackedMessageEvents(message.id),
    resolveRegisteredApp(message.app_id),
    canReplay ? getReplayContext(message.id) : Promise.resolve({ recoveryAvailable: false, recoveryExpiresAt: null, alreadyReplayed: false, replayMessageId: null }),
  ]);
  const diagnostic = diagnoseMessage(message, events);
  const replayDecision = getSafeReplayDecision(message, replayContext);
  const topology = getProviderTopology();

  return <AppShell active="Actividad" requiredPermission="messages.read" appId={message.app_id}><PageHeader eyebrow="Search & Recovery" title={statusLabels[message.status] ?? message.status} description={`Diagnóstico y trazabilidad completa de un correo de ${app?.name ?? message.app_id}.`} action={<div className="header-actions"><Link className="secondary-button" href="/activity">← Buscar correos</Link><Link className="secondary-button" href={`/apps/${message.app_id}`}>Ver aplicación →</Link></div>} />
    <section className={`diagnostic-hero ${diagnostic.severity}`}>
      <div><span className="eyebrow">DIAGNÓSTICO · {diagnostic.code}</span><h2>{diagnostic.title}</h2><p>{diagnostic.explanation}</p><strong>{diagnostic.action}</strong></div>
      <span className={`diagnostic-state ${diagnostic.severity}`}>{diagnostic.severity === "success" ? "OK" : diagnostic.severity === "critical" ? "CRÍTICO" : diagnostic.severity === "warning" ? "REVISAR" : "EN CURSO"}</span>
    </section>

    <section className="two-col">
      <article className="panel"><div className="panel-head"><div><span className="eyebrow">IDENTIDAD</span><h2>Datos del correo</h2></div><span className={`status-badge ${message.status}`}>{statusLabels[message.status] ?? message.status}</span></div><dl className="tracking-meta"><div><dt>Aplicación</dt><dd>{app?.name ?? message.app_id}</dd></div><div><dt>Tracking ID</dt><dd><code className="tracking-id">{message.id}</code></dd></div><div><dt>Plantilla</dt><dd><code>{message.template_key}</code></dd></div><div><dt>Versión</dt><dd>{templateVersionLabel(message.template_source, message.template_version)}</dd></div><div><dt>Prioridad</dt><dd>{message.priority}</dd></div><div><dt>Proveedor</dt><dd><code>{message.provider_name ?? "—"}</code></dd></div><div><dt>Proveedor ID</dt><dd><code>{message.provider_id ?? "—"}</code></dd></div><div><dt>Solicitado</dt><dd>{date(message.created_at)}</dd></div><div><dt>Aceptado</dt><dd>{date(message.accepted_at)}</dd></div><div><dt>Entregado</dt><dd>{date(message.delivered_at)}</dd></div>{message.replay_of_message_id && <div><dt>Replay de</dt><dd><Link className="text-link" href={`/activity/${message.replay_of_message_id}`}>{message.replay_of_message_id.slice(0,8)}…</Link></dd></div>}{message.failure_code && <div><dt>Motivo</dt><dd><code>{message.failure_code}</code></dd></div>}</dl></article>
      <article className="panel"><div className="panel-head"><div><span className="eyebrow">PRIVACIDAD</span><h2>Destinatario protegido</h2></div></div><p className="detail-copy">El ledger no guarda la dirección en claro. Una búsqueda por destinatario se resuelve calculando el mismo hash SHA-256 en el servidor.</p><code className="tracking-id">{message.recipient_hash}</code><div className="privacy-note"><strong>Recovery envelope</strong><span>Solo las plantillas no críticas aprobadas pueden conservar temporalmente un payload cifrado AES-256-GCM. P0 nunca lo utiliza para replay.</span></div></article>
    </section>

    {canReplay ? <section className="panel recovery-panel"><div className="panel-head"><div><span className="eyebrow">SAFE REPLAY</span><h2>Recuperación controlada</h2></div><span className={replayDecision.allowed ? "pill success" : "pill neutral"}>{replayDecision.allowed ? "Disponible" : "Protegido"}</span></div>
      <RecoveryActions messageId={message.id} decision={replayDecision} recoveryExpiresAt={replayContext.recoveryExpiresAt} replayMessageId={replayContext.replayMessageId} secondaryReady={topology.secondaryReady} manualFailover={topology.failoverMode === "manual"} />
      <div className="recovery-policy-grid"><span>✓ Un solo replay por correo origen</span><span>✓ Nuevo tracking + idempotencia</span><span>✓ Supresión y reputación revalidadas</span><span>✓ Cuotas/circuit breaker aplican</span><span>✓ P0 exige token nuevo</span><span>✓ Timeout ambiguo bloquea failover</span></div>
    </section> : <section className="panel recovery-panel"><div className="panel-head"><div><span className="eyebrow">SAFE REPLAY</span><h2>Solo diagnóstico</h2></div><span className="pill neutral">Sin permiso de replay</span></div><p className="detail-copy">Tu rol puede investigar este correo, pero LVL Mail no carga ni expone acciones de recuperación.</p></section>}

    <section className="panel"><div className="panel-head"><div><span className="eyebrow">TIMELINE</span><h2>Eventos del correo</h2></div><span className="pill neutral">{events.length} eventos</span></div><div className="timeline"><div className="timeline-event"><div className="timeline-dot">1</div><div><strong>Solicitud recibida por LVL Mail</strong><small>Asignada a {app?.name ?? message.app_id} con {templateVersionLabel(message.template_source, message.template_version)} antes de contactar al proveedor.</small></div><time dateTime={message.created_at}>{date(message.created_at)}</time></div>{events.map((event, index) => <div className="timeline-event" key={event.provider_event_id}><div className="timeline-dot">{index + 2}</div><div><strong>{eventLabels[event.event_type] ?? event.event_type}</strong><small>{event.event_type}</small></div><time dateTime={event.occurred_at}>{date(event.occurred_at)}</time></div>)}</div></section>
  </AppShell>;
}
