import { AppShell, PageHeader } from "@/components/app-shell";
import { listRegisteredApps } from "@/lib/app-registry";
import { getAppHealth } from "@/lib/supabase-rest";

export const metadata = { title: "Reputación" };
const rules = [
  ["Hard bounce", "Suprimir destinatario", "Evita insistir sobre direcciones inválidas."],
  ["Complaint", "Bloqueo global", "Un complaint se replica a la lista local de supresión."],
  ["Fallo de observabilidad", "No frenar P0", "Si Supabase falla, un correo de acceso puede continuar protegido por Resend."],
  ["Marketing", "Deshabilitado", "No se expone hasta contar con consentimiento, unsubscribe y límites persistentes."],
];

function rate(value: number | null | undefined) {
  return typeof value === "number" ? `${value.toFixed(3)}%` : "0.000%";
}

export default async function ReputationPage() {
  const [health, apps] = await Promise.all([getAppHealth(), listRegisteredApps()]);
  const appMap = new Map(apps.map((app) => [app.id, app]));
  return <AppShell active="Reputación"><PageHeader eyebrow="Deliverability" title="Protección de reputación" description="LVL Mail observa cada aplicación por separado aunque todas compartan mail.lvltechmx.com." />
    {health.length > 0 && <section className="health-grid">{health.map((item) => { const brand = appMap.get(item.app_id); const warning = (item.bounce_rate ?? 0) >= 2 || (item.complaint_rate ?? 0) >= 0.05; return <article className="health-card" key={item.app_id}><div className="health-top"><div className="app-logo" style={{background:brand?.surface ?? "#f8fafc",color:brand?.accent ?? "#111827"}}>{(brand?.name ?? item.app_id).slice(0,2).toUpperCase()}</div><span className={warning ? "pill warning" : "pill success"}>{warning ? "Revisar" : "Saludable"}</span></div><h2>{brand?.name ?? item.app_id}</h2><div className="health-stats"><div><span>Aceptados</span><strong>{item.accepted}</strong></div><div><span>Entregados</span><strong>{item.delivered}</strong></div><div><span>Bounce</span><strong>{rate(item.bounce_rate)}</strong></div><div><span>Complaint</span><strong>{rate(item.complaint_rate)}</strong></div></div></article>})}</section>}
    <section className="panel"><div className="panel-head"><div><span className="eyebrow">POLÍTICAS</span><h2>Respuesta automática</h2></div><span className="pill neutral">30 días por aplicación</span></div><div className="rule-list">{rules.map(([signal,action,desc]) => <div className="rule-row" key={signal}><div><span className="rule-label">Señal</span><strong>{signal}</strong></div><div><span className="rule-label">Acción</span><strong>{action}</strong></div><p>{desc}</p></div>)}</div></section>
  </AppShell>;
}
