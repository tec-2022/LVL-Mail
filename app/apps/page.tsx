import Link from "next/link";
import { AppShell, PageHeader } from "@/components/app-shell";
import { listRegisteredApps } from "@/lib/app-registry";
import { supabaseConfigured } from "@/lib/supabase-rest";
import { getAppPolicy } from "@/lib/control-plane";

export const metadata = { title: "Aplicaciones" };

export default async function AppsPage() {
  const apps = await listRegisteredApps();
  const persistenceReady = supabaseConfigured();
  const policies = new Map((await Promise.all(apps.map(async (app) => [app.id, await getAppPolicy(app.id)] as const))));

  return <AppShell active="Aplicaciones"><PageHeader eyebrow="Fleet control" title="Aplicaciones" description="Cada web tiene identidad, credenciales, políticas y tracking independientes aunque todas compartan mail.lvltechmx.com." action={<Link className="button" href="/apps/new">+ Agregar web</Link>} />
    <section className="quick-onboarding-banner">
      <div><span className="eyebrow">ALTA RÁPIDA</span><h2>Agregar una web requiere solo su URL.</h2><p>LVL Mail genera ID, remitente, plantillas, credencial, tracking y políticas seguras por defecto.</p></div>
      <Link className="secondary-button" href="/apps/new">Agregar web →</Link>
    </section>
    {!persistenceReady && <div className="platform-notice"><strong>Modo preparación</strong><span>El control plane está listo. Las altas y políticas persistentes se activarán cuando conectemos la infraestructura.</span></div>}
    <section className="cards-grid">{apps.map((app) => { const policy = policies.get(app.id); const mode = policy?.mode ?? "live"; return <article className="app-card" key={app.id}><div className="app-card-top"><div className="app-logo large" style={{background:app.surface,color:app.accent}}>{app.name.slice(0,2).toUpperCase()}</div><div className="app-card-badges"><span className={mode === "live" ? "pill success" : mode === "test" ? "pill warning" : "pill neutral"}>{mode === "live" ? "Live" : mode === "test" ? "Test" : "Pausada"}</span>{policy?.circuit_state === "open" && <span className="pill warning">Circuito abierto</span>}</div></div><h2>{app.name}</h2><p>{app.tagline}</p><dl><div><dt>ID</dt><dd><code>{app.id}</code></dd></div><div><dt>Remitente</dt><dd>{app.senderLocalPart}@mail.lvltechmx.com</dd></div>{app.websiteUrl && <div><dt>Web</dt><dd>{app.websiteUrl}</dd></div>}<div><dt>Capacidad</dt><dd>{policy?.minute_limit ?? 60}/min · {policy?.daily_limit ?? 3000}/día</dd></div><div><dt>P0 reservado</dt><dd>{policy?.p0_reserved_per_minute ?? 20}/min</dd></div><div><dt>Tracking</dt><dd>Obligatorio por correo</dd></div></dl><div style={{marginTop:"16px"}}><Link className="secondary-button" href={`/apps/${app.id}`}>Abrir control center →</Link></div></article>})}</section>
  </AppShell>;
}
