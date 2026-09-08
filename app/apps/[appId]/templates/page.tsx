import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppShell, PageHeader, PriorityBadge } from "@/components/app-shell";
import { resolveRegisteredApp } from "@/lib/app-registry";
import { getPublishedTemplateVersion, listTemplateVersions, templateDefinitions } from "@/lib/template-studio";
import { canAccessApp, getPagePrincipal, hasPermission } from "@/lib/iam";

export const metadata = { title: "Template Studio" };

export default async function AppTemplatesPage({ params }: { params: Promise<{ appId: string }> }) {
  const principal = await getPagePrincipal();
  if (!principal) redirect("/login?error=access");
  if (!hasPermission(principal.role, "templates.read")) redirect("/");

  const { appId } = await params;
  if (!canAccessApp(principal, appId)) redirect("/templates");
  const app = await resolveRegisteredApp(appId);
  if (!app) notFound();

  const definitions = Object.values(templateDefinitions);
  const states = await Promise.all(definitions.map(async (definition) => {
    const [published, versions] = await Promise.all([
      getPublishedTemplateVersion(appId, definition.key).catch(() => null),
      listTemplateVersions(appId, definition.key).catch(() => []),
    ]);
    return { definition, published, draft: versions.find((version) => version.status === "draft") ?? null, count: versions.length };
  }));

  return <AppShell active="Aplicaciones" requiredPermission="templates.read" appId={appId}><PageHeader eyebrow="Template Studio" title={`Plantillas · ${app.name}`} description="Diseña, previsualiza, prueba y versiona los correos de esta web sin editar HTML ni redeployar la aplicación." action={<Link className="secondary-button" href={`/apps/${appId}`}>← Control center</Link>} />
    <section className="platform-notice"><strong>Safe-by-design</strong><span>Los CTA críticos, OTP, URLs HTTPS, prioridad, tracking y scope siguen controlados por LVL Mail aunque cambie el copy.</span></section>
    <section className="template-studio-list">{states.map(({ definition, published, draft, count }) => <article className="template-studio-card" key={definition.key}><div className="template-studio-card-head"><div><span className="eyebrow">{definition.key}</span><h2>{definition.name}</h2></div><PriorityBadge priority={definition.priority}/></div><p>{definition.description}</p><div className="template-version-summary"><span><strong>{published ? `v${published.version}` : "Base"}</strong><small>Producción</small></span><span><strong>{draft ? `v${draft.version}` : "—"}</strong><small>Draft</small></span><span><strong>{count}</strong><small>Versiones</small></span></div><div className="template-protections">{definition.protectedStructure.map((item) => <span key={item}>✓ {item}</span>)}</div><Link className="button" href={`/apps/${appId}/templates/${definition.key}`}>Abrir editor →</Link></article>)}</section>
  </AppShell>;
}
