import Link from "next/link";
import { AppShell, PageHeader } from "@/components/app-shell";
import { AppOnboarding } from "@/components/app-onboarding";

export const metadata = { title: "Agregar web" };

export default function NewAppPage() {
  return <AppShell active="Aplicaciones" requiredPermission="apps.manage">
    <PageHeader eyebrow="Aplicaciones" title="Agregar una web" description="Un alta simple para conectar cualquier producto a LVL Mail sin tocar Resend ni crear dominios adicionales." action={<Link className="text-link" href="/apps">← Volver a aplicaciones</Link>} />
    <section className="onboarding-layout">
      <article className="panel onboarding-card"><AppOnboarding /></article>
      <aside className="panel onboarding-side">
        <span className="eyebrow">SIN FRICCIÓN</span>
        <h2>Una web, una clave.</h2>
        <p>Cada aplicación recibe su propia credencial y comparte la infraestructura de <strong>mail.lvltechmx.com</strong>. No necesita entrar a Resend ni configurar DNS.</p>
        <div className="mini-process">
          <div><b>1</b><span><strong>Pega la URL</strong><small>El nombre y el identificador se detectan automáticamente.</small></span></div>
          <div><b>2</b><span><strong>Guarda la clave</strong><small>Se genera una credencial única y solo se muestra una vez.</small></span></div>
          <div><b>3</b><span><strong>Copia el ejemplo</strong><small>La app ya puede usar confirmación, OTP y notificaciones.</small></span></div>
        </div>
        <div className="security-note"><strong>Seguro por defecto</strong><span>La web no obtiene la API key de Resend y no puede marcar campañas como P0.</span></div>
      </aside>
    </section>
  </AppShell>;
}
