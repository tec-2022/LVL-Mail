import Link from "next/link";
import { AppShell, PageHeader, PriorityBadge } from "@/components/app-shell";
import { Icon } from "@/components/icons";
import { appBrands } from "@/lib/mail-policy";
import { getDashboardMetrics } from "@/lib/supabase-rest";

const apps = Object.values(appBrands);

function percent(value: number | null) {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}

export default async function Home() {
  const metrics = await getDashboardMetrics();
  const deliveryRate = metrics && metrics.accepted > 0
    ? (metrics.delivered / metrics.accepted) * 100
    : null;

  return (
    <AppShell active="Resumen">
      <PageHeader eyebrow="Estado del sistema" title="Correo crítico, primero." description="LVL Mail centraliza el envío de todas nuestras aplicaciones y reserva la vía rápida para confirmaciones, recuperación y OTP." action={<Link className="button" href="/templates">Ver plantillas <Icon name="arrow" width="16" height="16" /></Link>} />
      <section className="metrics-grid">
        <article className="metric-card featured"><div className="metric-icon"><Icon name="bolt" width="20" height="20" /></div><span>Vía crítica P0</span><strong>Activa</strong><small>Sin batching para autenticación</small></article>
        <article className="metric-card"><span>Aceptados · 24 h</span><strong>{metrics?.accepted ?? "—"}</strong><small>{metrics ? `${metrics.bounced} rebotes · ${metrics.complained} complaints` : "Disponible al conectar Supabase + webhook"}</small></article>
        <article className="metric-card"><span>Entregabilidad · 24 h</span><strong>{percent(deliveryRate)}</strong><small>{metrics ? `${metrics.delivered} entregados · ${metrics.suppressed} suprimidos` : "Sin datos inventados"}</small></article>
        <article className="metric-card"><span>Dominio de envío</span><strong className="metric-domain">mail.lvltechmx.com</strong><small>{apps.length} identidades registradas</small></article>
      </section>

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
            <div><Icon name="check" width="18" height="18"/><span><strong>HTML centralizado + HTTPS</strong><small>Las apps no inyectan plantillas ni CTA inseguros.</small></span></div>
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="panel-head"><div><span className="eyebrow">APLICACIONES</span><h2>Identidades de correo</h2></div><Link href="/apps" className="text-link">Administrar aplicaciones →</Link></div>
        <div className="app-table">
          {apps.map((app) => <div className="app-row" key={app.id}><div className="app-logo" style={{ background: app.surface, color: app.accent }}>{app.name.slice(0,2).toUpperCase()}</div><div className="app-name"><strong>{app.name}</strong><span>{app.tagline}</span></div><code>{app.senderLocalPart}@mail.lvltechmx.com</code><span className="pill neutral">Gateway</span></div>)}
        </div>
      </section>
    </AppShell>
  );
}
