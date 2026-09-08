import Link from "next/link";
import { AppShell, PageHeader } from "@/components/app-shell";
import { listRegisteredApps } from "@/lib/app-registry";
import { supabaseConfigured } from "@/lib/supabase-rest";

export const metadata = { title: "Aplicaciones" };

export default async function AppsPage() {
  const apps = await listRegisteredApps();
  const persistenceReady = supabaseConfigured();

  return <AppShell active="Aplicaciones"><PageHeader eyebrow="Multi-app" title="Aplicaciones" description="Conecta cualquier web a LVL Mail sin registrar otro dominio ni administrar credenciales de Resend." action={<Link className="button" href="/apps/new">+ Agregar web</Link>} />
    <section className="quick-onboarding-banner">
      <div><span className="eyebrow">ALTA RÁPIDA</span><h2>Agregar una web requiere solo su URL.</h2><p>LVL Mail genera automáticamente el ID, remitente, plantillas y clave privada.</p></div>
      <Link className="secondary-button" href="/apps/new">Agregar web →</Link>
    </section>
    {!persistenceReady && <div className="platform-notice"><strong>Modo preparación</strong><span>El onboarding ya está listo. Las nuevas altas se habilitarán al conectar la persistencia de LVL Mail.</span></div>}
    <section className="cards-grid">{apps.map((app) => <article className="app-card" key={app.id}><div className="app-card-top"><div className="app-logo large" style={{background:app.surface,color:app.accent}}>{app.name.slice(0,2).toUpperCase()}</div><span className={app.isEnabled ? "pill success" : "pill neutral"}>{app.isEnabled ? "Activa" : "Pausada"}</span></div><h2>{app.name}</h2><p>{app.tagline}</p><dl><div><dt>ID</dt><dd><code>{app.id}</code></dd></div><div><dt>Remitente</dt><dd>{app.senderLocalPart}@mail.lvltechmx.com</dd></div>{app.websiteUrl && <div><dt>Web</dt><dd>{app.websiteUrl}</dd></div>}<div><dt>Clave</dt><dd>Independiente · hash almacenado</dd></div></dl></article>)}</section>
  </AppShell>;
}
