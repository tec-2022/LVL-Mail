import { AppShell, PageHeader } from "@/components/app-shell";

export const metadata = { title: "Configuración" };
export default function SettingsPage() {
  return <AppShell active="Configuración"><PageHeader eyebrow="Infrastructure" title="Configuración" description="Variables y pasos necesarios para poner LVL Mail en producción." />
    <section className="settings-grid"><article className="panel"><span className="eyebrow">DOMINIO</span><h2>mail.lvltechmx.com</h2><p>Verifica este subdominio en Resend y publica los registros SPF/DKIM indicados por el proveedor.</p><div className="setting-status"><span className="status-dot amber"/>Pendiente de verificación externa</div></article>
    <article className="panel"><span className="eyebrow">SECRETS</span><h2>Variables del servidor</h2><div className="code-stack"><code>RESEND_API_KEY</code><code>LVL_MAIL_APP_KEYS</code><code>LVL_MAIL_SENDING_DOMAIN</code></div><p>Nunca deben utilizar prefijos <code>NEXT_PUBLIC_</code>.</p></article>
    <article className="panel"><span className="eyebrow">WEBHOOK</span><h2>Eventos de Resend</h2><p>La siguiente fase persistirá delivered, bounced, complained, delayed y failed para calcular reputación real por aplicación.</p></article>
    <article className="panel"><span className="eyebrow">SEGURIDAD</span><h2>Consola administrativa</h2><p>Antes de publicar métricas o datos de clientes, protege el panel con autenticación administrativa. La API de envío ya exige una clave independiente por aplicación.</p></article></section>
  </AppShell>;
}
