import { AppShell, PageHeader } from "@/components/app-shell";
import { appBrands } from "@/lib/mail-policy";
import { getRecentEvents } from "@/lib/supabase-rest";

export const metadata = { title: "Actividad" };

function eventLabel(type: string) {
  const labels: Record<string, string> = {
    "email.sent": "Enviado",
    "email.delivered": "Entregado",
    "email.delivery_delayed": "Retrasado",
    "email.bounced": "Rebotado",
    "email.complained": "Complaint",
    "email.failed": "Fallido",
    "email.suppressed": "Suprimido",
    "email.opened": "Abierto",
    "email.clicked": "Clic",
  };
  return labels[type] ?? type;
}

export default async function ActivityPage() {
  const events = await getRecentEvents(40);
  return <AppShell active="Actividad"><PageHeader eyebrow="Observabilidad" title="Actividad de correo" description="Eventos verificados de Resend, almacenados por LVL Mail sin exponer la dirección del destinatario." />
    {events.length === 0 ? <section className="panel empty-state"><div className="empty-icon">↗</div><h2>Aún no hay eventos persistidos</h2><p>Cuando configures Supabase y apuntes el webhook firmado de Resend a <code>/api/webhooks/resend</code>, esta vista se alimentará automáticamente.</p></section> :
    <section className="panel"><div className="panel-head"><div><span className="eyebrow">ÚLTIMOS EVENTOS</span><h2>Flujo de entrega</h2></div><span className="pill success">Webhook verificado</span></div><div className="event-table"><div className="event-row event-head"><span>Evento</span><span>Aplicación</span><span>Plantilla</span><span>Fecha</span></div>{events.map((event) => { const appId = event.mail_messages?.app_id; const brand = appId ? appBrands[appId] : null; return <div className="event-row" key={event.provider_event_id}><span><strong>{eventLabel(event.event_type)}</strong><small>{event.event_type}</small></span><span>{brand?.name ?? appId ?? "—"}</span><code>{event.mail_messages?.template_key ?? "—"}</code><time dateTime={event.occurred_at}>{new Intl.DateTimeFormat("es-MX", { dateStyle:"medium", timeStyle:"short", timeZone:"America/Tijuana" }).format(new Date(event.occurred_at))}</time></div>})}</div></section>}
  </AppShell>;
}
