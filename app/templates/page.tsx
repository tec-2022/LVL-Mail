import Link from "next/link";
import { AppShell, PageHeader, PriorityBadge } from "@/components/app-shell";
import { listRegisteredApps } from "@/lib/app-registry";
import { templateDefinitions } from "@/lib/template-studio";

export const metadata = { title: "Template Studio" };

export default async function TemplatesPage() {
  const apps = await listRegisteredApps();
  const templates = Object.values(templateDefinitions);
  return <AppShell active="Plantillas"><PageHeader eyebrow="Template Studio" title="Plantillas de correo" description="Un design system seguro con copy versionado por aplicación, preview, test-send y rollback sin redeployar las webs." />
    <section className="quick-onboarding-banner"><div><span className="eyebrow">POR APLICACIÓN</span><h2>Cada web conserva su propia identidad y versiones.</h2><p>El HTML, las prioridades y la estructura crítica siguen gobernados por LVL Mail.</p></div></section>
    <section className="cards-grid">{apps.map((app) => <article className="app-card" key={app.id}><div className="app-card-top"><div className="app-logo large" style={{background:app.surface,color:app.accent}}>{app.name.slice(0,2).toUpperCase()}</div><span className={app.isEnabled ? "pill success" : "pill neutral"}>{app.isEnabled ? "Activa" : "Pausada"}</span></div><h2>{app.name}</h2><p>{app.tagline}</p><dl><div><dt>Remitente</dt><dd>{app.senderLocalPart}@mail.lvltechmx.com</dd></div><div><dt>Studio</dt><dd>Draft · Publish · Rollback</dd></div></dl><div style={{marginTop:"16px"}}><Link className="button" href={`/apps/${app.id}/templates`}>Abrir Template Studio →</Link></div></article>)}</section>
    <section className="panel" style={{marginTop:"18px"}}><div className="panel-head"><div><span className="eyebrow">CATÁLOGO BASE</span><h2>Estructura protegida</h2></div><span className="pill neutral">5 plantillas</span></div><div className="template-grid">{templates.map((template) => <article className="template-card" key={template.key}><div className="template-preview"><div className="mini-logo"/><div className="mini-line wide"/><div className="mini-line"/><div className="mini-button"/></div><div className="template-info"><div className="template-title"><h2>{template.name}</h2><PriorityBadge priority={template.priority}/></div><code>{template.key}</code><p>{template.description}</p><div className="template-meta">{template.protectedStructure.map((item) => <span key={item}>{item}</span>)}</div></div></article>)}</div></section>
  </AppShell>;
}
