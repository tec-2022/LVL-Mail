import { AppShell, PageHeader } from "@/components/app-shell";

export const metadata = { title: "Reputación" };
const rules = [
  ["Hard bounce", "Suprimir destinatario", "Evita insistir sobre direcciones inválidas."],
  ["Complaint", "Bloqueo global", "Un complaint debe detener futuros envíos no esenciales."],
  ["Pico anormal", "Limitar aplicación", "Una sola app no debe poner en riesgo a las demás."],
  ["Marketing", "Opt-in + unsubscribe", "No se habilita hasta tener consentimiento y supresiones persistentes."],
];
export default function ReputationPage() {
  return <AppShell active="Reputación"><PageHeader eyebrow="Deliverability" title="Protección de reputación" description="LVL Mail está diseñado para aislar errores de aplicación antes de que afecten a mail.lvltechmx.com." />
    <section className="panel"><div className="panel-head"><div><span className="eyebrow">POLÍTICAS</span><h2>Respuesta automática</h2></div></div><div className="rule-list">{rules.map(([signal,action,desc]) => <div className="rule-row" key={signal}><div><span className="rule-label">Señal</span><strong>{signal}</strong></div><div><span className="rule-label">Acción</span><strong>{action}</strong></div><p>{desc}</p></div>)}</div></section>
  </AppShell>;
}
