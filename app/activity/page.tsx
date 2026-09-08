import { redirect } from "next/navigation";
import { AppShell, PageHeader } from "@/components/app-shell";
import { SearchWorkbench } from "@/components/search-workbench";
import { listRegisteredApps } from "@/lib/app-registry";
import { searchMessages } from "@/lib/message-search";
import { getProviderTopology } from "@/lib/mail-provider";
import { filterAppScoped, getPagePrincipal, scopeAppIds } from "@/lib/iam";

export const metadata = { title: "Search & Recovery" };

export default async function ActivityPage() {
  const principal = await getPagePrincipal();
  if (!principal) redirect("/login?error=access");
  const apps = filterAppScoped(principal, await listRegisteredApps(), (app) => app.id);
  const messages = await searchMessages({ limit: 100, allowedAppIds: scopeAppIds(principal) });
  const topology = getProviderTopology();
  const providers = Array.from(new Set([
    topology.primary,
    ...(topology.secondary ? [topology.secondary] : []),
  ])).filter(Boolean);

  return <AppShell active="Actividad" requiredPermission="messages.read"><PageHeader eyebrow="Search & Recovery" title="Encontrar, diagnosticar y recuperar" description={principal.allApps ? "Busca cualquier intento por tracking, aplicación, plantilla, versión, estado, proveedor, fecha o destinatario exacto." : "La búsqueda, los resultados y las acciones de recuperación están limitados a tus aplicaciones autorizadas."} />
    <section className="platform-notice"><strong>Recuperación con guardrails</strong><span>OTP, confirmación y password reset siempre requieren un intento nuevo desde la aplicación origen. Safe Replay solo existe para fallos definitivos de plantillas no críticas.</span></section>
    <SearchWorkbench
      apps={apps.map((app) => ({ id: app.id, name: app.name }))}
      providers={providers}
      initialMessages={messages}
    />
  </AppShell>;
}
