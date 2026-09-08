import { AppShell, PageHeader } from "@/components/app-shell";
import { SearchWorkbench } from "@/components/search-workbench";
import { listRegisteredApps } from "@/lib/app-registry";
import { searchMessages } from "@/lib/message-search";
import { getProviderTopology } from "@/lib/mail-provider";

export const metadata = { title: "Search & Recovery" };

export default async function ActivityPage() {
  const [messages, apps] = await Promise.all([
    searchMessages({ limit: 100 }),
    listRegisteredApps(),
  ]);
  const topology = getProviderTopology();
  const providers = Array.from(new Set([
    topology.primary,
    ...(topology.secondary ? [topology.secondary] : []),
  ])).filter(Boolean);

  return <AppShell active="Actividad"><PageHeader eyebrow="Search & Recovery" title="Encontrar, diagnosticar y recuperar" description="Busca cualquier intento por tracking, aplicación, plantilla, versión, estado, proveedor, fecha o destinatario exacto. LVL Mail mantiene la dirección fuera del ledger y solo habilita recuperación cuando no existe riesgo de duplicar o reutilizar credenciales." />
    <section className="platform-notice"><strong>Recuperación con guardrails</strong><span>OTP, confirmación y password reset siempre requieren un intento nuevo desde la aplicación origen. Safe Replay solo existe para fallos definitivos de plantillas no críticas.</span></section>
    <SearchWorkbench
      apps={apps.map((app) => ({ id: app.id, name: app.name }))}
      providers={providers}
      initialMessages={messages}
    />
  </AppShell>;
}
