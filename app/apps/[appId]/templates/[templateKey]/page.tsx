import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app-shell";
import { TemplateStudioEditor } from "@/components/template-studio-editor";
import { resolveRegisteredApp } from "@/lib/app-registry";
import type { TemplateKey } from "@/lib/mail-policy";
import {
  listTemplateVersions,
  renderStudioTemplate,
  templateDefinitions,
  versionToCopy,
} from "@/lib/template-studio";

export const metadata = { title: "Editor de plantilla" };

function isTemplateKey(value: string): value is TemplateKey {
  return value in templateDefinitions;
}

export default async function TemplateEditorPage({ params }: { params: Promise<{ appId: string; templateKey: string }> }) {
  const { appId, templateKey: rawTemplateKey } = await params;
  if (!isTemplateKey(rawTemplateKey)) notFound();
  const templateKey = rawTemplateKey;
  const app = await resolveRegisteredApp(appId);
  if (!app) notFound();

  const definition = templateDefinitions[templateKey];
  const versions = await listTemplateVersions(appId, templateKey).catch(() => []);
  const workingVersion = versions.find((version) => version.status === "draft")
    ?? versions.find((version) => version.status === "published")
    ?? null;
  const initialCopy = workingVersion ? versionToCopy(workingVersion) : definition.defaults;
  const preview = renderStudioTemplate(app, templateKey, definition.sampleVariables, initialCopy);

  return <AppShell active="Aplicaciones"><PageHeader eyebrow="Template Studio" title={`${definition.name} · ${app.name}`} description="El preview usa datos de muestra. Guardar crea o actualiza un draft; publicar cambia producción sin redeployar la web." action={<Link className="secondary-button" href={`/apps/${appId}/templates`}>← Plantillas</Link>} />
    <TemplateStudioEditor
      appId={appId}
      appName={app.name}
      templateKey={templateKey}
      definition={definition}
      initialCopy={initialCopy}
      initialVersions={versions}
      initialPreviewHtml={preview.html}
      initialPreviewSubject={preview.subject}
    />
  </AppShell>;
}
