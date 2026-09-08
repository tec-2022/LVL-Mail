import { AppShell, PageHeader } from "@/components/app-shell";
import { appBrands } from "@/lib/mail-policy";

export const metadata = { title: "Aplicaciones" };

export default function AppsPage() {
  return <AppShell active="Aplicaciones"><PageHeader eyebrow="Multi-app" title="Aplicaciones" description="Cada producto conserva su identidad visual y remitente, aunque todos utilicen la misma infraestructura." />
    <section className="cards-grid">{Object.values(appBrands).map((app) => <article className="app-card" key={app.id}><div className="app-card-top"><div className="app-logo large" style={{background:app.surface,color:app.accent}}>{app.name.slice(0,2).toUpperCase()}</div><span className="pill neutral">Gateway</span></div><h2>{app.name}</h2><p>{app.tagline}</p><dl><div><dt>ID</dt><dd><code>{app.id}</code></dd></div><div><dt>Remitente</dt><dd>{app.senderLocalPart}@mail.lvltechmx.com</dd></div><div><dt>Autenticación</dt><dd>x-lvl-mail-key</dd></div></dl></article>)}</section>
  </AppShell>;
}
