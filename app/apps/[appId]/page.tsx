import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app-shell";
import { resolveRegisteredApp } from "@/lib/app-registry";
import { getAppTrackedMessages, getAppTrackingSummary } from "@/lib/mail-tracking";

export const metadata = { title: "Tracking por aplicación" };

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

export default async function AppTrackingPage({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params;
  const app = await resolveRegisteredApp(appId);
  if (!app) notFound();

  const [summary, messages] = await Promise.all([
    getAppTrackingSummary(appId),
    getAppTrackedMessages(appId, 100),
  ]);

  return <AppShell active="Aplicaciones"><PageHeader eyebrow="Tracking por web" title={app.name} description="Todo correo de esta web tiene un ID de tracking propio y una línea de tiempo completa dentro de LVL Mail." action={<Link className="secondary-button" href="/apps">← Aplicaciones</Link>} />
    <section className="panel app-detail-head"><div className="app-logo large" style={{background:app.surface,color:app.accent}}>{app.name.slice(0,2).toUpperCase()}</div><div><h2>{app.senderLocalPart}@mail.lvltechmx.com</h2><p>{app.websiteUrl ?? app.tagline}</p></div></section>

    <section className="tracking-summary">
      <article className="tracking-kpi"><span>Correos · 30 días</span><strong>{summary?.total_30d ?? "—"}</strong><small>Todos los intentos válidos</small></article>
      <article className="tracking-kpi"><span>Entregados · 30 días</span><strong>{summary?.delivered_30d ?? "—"}</strong><small>{summary?.delivery_rate_30d == null ? "Sin tasa todavía" : `${summary.delivery_rate_30d}% de los aceptados`}</small></article>
      <article className="tracking-kpi"><span>Bloqueados / fallidos</span><strong>{summary ? summary.blocked_30d + summary.failed_30d : "—"}</strong><small>Protecciones y errores de proveedor</small></article>
      <article className="tracking-kpi"><span>P0 · 24 horas</span><strong>{summary?.p0_24h ?? "—"}</strong><small>Confirmación, recuperación y OTP</small></article>
    </section>

    <section className="panel"><div className="panel-head"><div><span className="eyebrow">HISTORIAL</span><h2>Correos de {app.name}</h2></div><span className="pill neutral">Últimos {messages.length}</span></div>{messages.length === 0 ? <div className="empty-state"><h2>Sin correos todavía</h2><p>Cuando esta web empiece a enviar, cada correo aparecerá aquí desde el estado inicial.</p></div> : <div className="message-ledger"><div className="message-row message-head"><span>Estado</span><span>Tracking</span><span>Plantilla</span><span>Prioridad</span><span>Solicitado</span><span/></div>{messages.map((message) => <div className="message-row" key={message.id}><span><span className={`status-badge ${message.status}`}>{statusLabels[message.status] ?? message.status}</span></span><code>{message.id.slice(0,8)}…</code><code>{message.template_key}</code><strong>{message.priority}</strong><time dateTime={message.created_at}>{new Intl.DateTimeFormat("es-MX", { dateStyle:"medium", timeStyle:"short", timeZone:"America/Tijuana" }).format(new Date(message.created_at))}</time><Link className="message-link" href={`/activity/${message.id}`} aria-label="Ver correo">→</Link></div>)}</div>}</section>
  </AppShell>;
}
