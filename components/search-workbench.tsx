"use client";

import { useState } from "react";
import Link from "next/link";
import type { TrackedMessage } from "@/lib/mail-tracking";

type AppOption = { id: string; name: string };

type Props = {
  apps: AppOption[];
  providers: string[];
  initialMessages: TrackedMessage[];
};

type Filters = {
  query: string;
  appId: string;
  templateKey: string;
  templateVersion: string;
  status: string;
  providerName: string;
  recipient: string;
  from: string;
  to: string;
};

const emptyFilters: Filters = {
  query: "",
  appId: "",
  templateKey: "",
  templateVersion: "",
  status: "",
  providerName: "",
  recipient: "",
  from: "",
  to: "",
};

const statusLabels: Record<string, string> = {
  processing: "Procesando",
  blocked: "Bloqueado",
  provider_rejected: "Rechazado",
  accepted: "Aceptado",
  sent: "Enviado",
  delayed: "Retrasado",
  delivered: "Entregado",
  bounced: "Rebotado",
  complained: "Complaint",
  failed: "Fallido",
  suppressed: "Suprimido",
};

function date(value: string) {
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Tijuana",
  }).format(new Date(value));
}

export function SearchWorkbench({ apps, providers, initialMessages }: Props) {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [messages, setMessages] = useState(initialMessages);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);
  const appNames = new Map(apps.map((app) => [app.id, app.name]));

  async function search(nextFilters = filters) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/messages/search", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(nextFilters),
      });
      const payload = await response.json() as { error?: string; messages?: TrackedMessage[] };
      if (!response.ok) throw new Error(payload.error || "No se pudo buscar");
      setMessages(payload.messages ?? []);
      setSearched(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo buscar");
    } finally {
      setBusy(false);
    }
  }

  function clear() {
    setFilters(emptyFilters);
    setMessages(initialMessages);
    setSearched(false);
    setError("");
  }

  return <div className="search-workbench">
    <section className="panel search-panel">
      <div className="panel-head"><div><span className="eyebrow">SEARCH</span><h2>Encontrar un correo</h2></div><span className="pill neutral">Exact match sensible</span></div>
      <div className="search-grid">
        <label className="field search-wide"><span>Tracking / Provider ID / Idempotency</span><input value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} placeholder="UUID, provider ID o idempotency key" /></label>
        <label className="field"><span>Aplicación</span><select value={filters.appId} onChange={(event) => setFilters({ ...filters, appId: event.target.value })}><option value="">Todas</option>{apps.map((app) => <option key={app.id} value={app.id}>{app.name}</option>)}</select></label>
        <label className="field"><span>Plantilla</span><select value={filters.templateKey} onChange={(event) => setFilters({ ...filters, templateKey: event.target.value })}><option value="">Todas</option><option value="verify-email">Confirmar correo</option><option value="password-reset">Recuperar contraseña</option><option value="otp">OTP</option><option value="transactional-notice">Transaccional</option><option value="notification">Notificación</option></select></label>
        <label className="field"><span>Versión</span><input type="number" min="1" value={filters.templateVersion} onChange={(event) => setFilters({ ...filters, templateVersion: event.target.value })} placeholder="v#" /></label>
        <label className="field"><span>Estado</span><select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">Todos</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="field"><span>Proveedor</span><select value={filters.providerName} onChange={(event) => setFilters({ ...filters, providerName: event.target.value })}><option value="">Todos</option>{providers.map((provider) => <option key={provider} value={provider}>{provider}</option>)}</select></label>
        <label className="field search-wide"><span>Destinatario exacto</span><input type="email" autoComplete="off" value={filters.recipient} onChange={(event) => setFilters({ ...filters, recipient: event.target.value })} placeholder="usuario@ejemplo.com" /><small>No se coloca en la URL: el servidor lo transforma a SHA-256 para consultar el ledger.</small></label>
        <label className="field"><span>Desde</span><input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label>
        <label className="field"><span>Hasta</span><input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label>
      </div>
      <div className="search-actions"><button className="button" disabled={busy} onClick={() => search()}>{busy ? "Buscando…" : "Buscar"}</button><button className="secondary-button" disabled={busy} onClick={clear}>Limpiar</button></div>
      {error && <p className="search-error">{error}</p>}
    </section>

    <section className="panel search-results">
      <div className="panel-head"><div><span className="eyebrow">LEDGER</span><h2>{searched ? "Resultados" : "Últimos correos"}</h2></div><span className="pill neutral">{messages.length} encontrados</span></div>
      {messages.length === 0 ? <div className="empty-state"><h2>Sin coincidencias</h2><p>No hay correos que cumplan estos filtros o la persistencia de Search & Recovery todavía no está conectada.</p></div> : <div className="search-ledger"><div className="search-row search-head"><span>Estado</span><span>Aplicación</span><span>Plantilla</span><span>Proveedor</span><span>Tracking</span><span>Fecha</span><span/></div>{messages.map((message) => <div className="search-row" key={message.id}><span><span className={`status-badge ${message.status}`}>{statusLabels[message.status] ?? message.status}</span></span><strong>{appNames.get(message.app_id) ?? message.app_id}</strong><div className="tracking-cell"><code>{message.template_key}</code>{message.template_version && <small>v{message.template_version}</small>}</div><code>{message.provider_name ?? "—"}</code><div className="tracking-cell"><code>{message.id.slice(0,8)}…</code>{message.replay_of_message_id && <small>Replay</small>}</div><time dateTime={message.created_at}>{date(message.created_at)}</time><Link className="message-link" href={`/activity/${message.id}`} aria-label="Diagnosticar correo">→</Link></div>)}</div>}
    </section>
  </div>;
}
