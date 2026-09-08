import { AppShell, PageHeader, PriorityBadge } from "@/components/app-shell";

export const metadata = { title: "Plantillas" };
const templates = [
  ["verify-email", "Confirmar correo", "Activa la cuenta mediante un CTA seguro.", "P0"],
  ["password-reset", "Recuperar contraseña", "Flujo de seguridad con enlace de expiración corta.", "P0"],
  ["otp", "Código OTP", "Código de acceso destacado y sin enlaces innecesarios.", "P0"],
  ["transactional-notice", "Aviso transaccional", "Pedidos, reservas, facturas e invitaciones.", "P1"],
  ["notification", "Notificación", "Reportes, avisos y actualizaciones no bloqueantes.", "P2"],
] as const;

export default function TemplatesPage() {
  return <AppShell active="Plantillas"><PageHeader eyebrow="Design system" title="Plantillas centralizadas" description="Toda web nueva hereda estas plantillas automáticamente. Solo envía datos; LVL Mail controla estructura, accesibilidad, marca y prioridad." />
    <section className="platform-notice"><strong>Sin configuración por web</strong><span>Al agregar una aplicación, confirmación, recuperación, OTP, transaccional y notificación quedan disponibles inmediatamente.</span></section>
    <section className="template-grid">{templates.map(([key,name,desc,p]) => <article className="template-card" key={key}><div className="template-preview"><div className="mini-logo"/><div className="mini-line wide"/><div className="mini-line"/><div className="mini-button"/></div><div className="template-info"><div className="template-title"><h2>{name}</h2><PriorityBadge priority={p}/></div><code>{key}</code><p>{desc}</p><div className="template-meta"><span>Responsive</span><span>Texto plano</span><span>Branding por app</span><span>Auto-heredada</span></div></div></article>)}</section>
  </AppShell>;
}
