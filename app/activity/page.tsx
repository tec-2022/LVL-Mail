import { AppShell, PageHeader } from "@/components/app-shell";

export const metadata = { title: "Actividad" };
export default function ActivityPage() {
  return <AppShell active="Actividad"><PageHeader eyebrow="Observabilidad" title="Actividad de correo" description="Aquí aparecerán los envíos y eventos de Resend cuando se conecte el webhook." />
    <section className="panel empty-state"><div className="empty-icon">↗</div><h2>Aún no hay eventos</h2><p>Configura <code>RESEND_API_KEY</code> y el webhook de Resend. No mostramos métricas inventadas antes de tener datos reales.</p></section>
  </AppShell>;
}
