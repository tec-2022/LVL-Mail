import Link from "next/link";
import { AppShell, PageHeader } from "@/components/app-shell";
import { listRegisteredApps } from "@/lib/app-registry";
import { getRecentTrackedMessages } from "@/lib/mail-tracking";

export const metadata = { title: "Actividad" };

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

export default async function ActivityPage() {
  const [messages, apps] = await Promise.all([
    getRecentTrackedMessages(100),
    listRegisteredApps(),
  ]);
  const appNames = new Map(apps.map((app) => [app.id, app.name]));

  return <AppShell active="Actividad"><PageHeader eyebrow="Trazabilidad" title="Todos los correos" description="Cada intento válido queda ligado a una web antes de llegar a Resend, incluso si termina bloqueado, rechazado, rebotado o fallido." />
    {messages.length === 0 ? <section className="panel empty-state"><div className="empty-icon">↗</div><h2>Aún no hay correos trackeados</h2><p>Cuando conectemos la persistencia, todo envío válido aparecerá aquí desde su primer estado, no solo después de ser aceptado por el proveedor.</p></section> :
    <section className="panel"><div className="panel-head"><div><span className="eyebrow">LEDGER</span><h2>Últimos correos</h2></div><span className="pill success">Tracking obligatorio</span></div><div className="message-ledger"><div className="message-row message-head"><span>Estado</span><span>Aplicación</span><span>Plantilla</span><span>Prioridad</span><span>Solicitado</span><span/></div>{messages.map((message) => <div className="message-row" key={message.id}><span><span className={`status-badge ${message.status}`}>{statusLabels[message.status] ?? message.status}</span></span><span>{appNames.get(message.app_id) ?? message.app_id}</span><code>{message.template_key}</code><strong>{message.priority}</strong><time dateTime={message.created_at}>{new Intl.DateTimeFormat("es-MX", { dateStyle:"medium", timeStyle:"short", timeZone:"America/Tijuana" }).format(new Date(message.created_at))}</time><Link className="message-link" href={`/activity/${message.id}`} aria-label="Ver trazabilidad">→</Link></div>)}</div></section>}
  </AppShell>;
}
