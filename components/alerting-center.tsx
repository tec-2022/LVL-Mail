"use client";

import { useMemo, useState } from "react";
import type { AlertChannel, AlertDelivery, AlertRule } from "@/lib/alerting";

type AppOption = { id: string; name: string };

type Props = {
  apps: AppOption[];
  initialChannels: AlertChannel[];
  initialRules: AlertRule[];
  recentDeliveries: AlertDelivery[];
  canManage: boolean;
  encryptionReady: boolean;
};

function date(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Tijuana",
  }).format(new Date(value));
}

export function AlertingCenter({
  apps,
  initialChannels,
  initialRules,
  recentDeliveries,
  canManage,
  encryptionReady,
}: Props) {
  const [channels, setChannels] = useState(initialChannels);
  const [rules, setRules] = useState(initialRules);
  const [channelName, setChannelName] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [ruleName, setRuleName] = useState("");
  const [ruleChannel, setRuleChannel] = useState(initialChannels[0]?.id ?? "");
  const [ruleApp, setRuleApp] = useState("");
  const [incidentType, setIncidentType] = useState("");
  const [minSeverity, setMinSeverity] = useState<"warning" | "critical">("warning");
  const [notifyOpen, setNotifyOpen] = useState(true);
  const [notifyEscalation, setNotifyEscalation] = useState(true);
  const [notifyRecovery, setNotifyRecovery] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [signingSecret, setSigningSecret] = useState<string | null>(null);

  const channelMap = useMemo(() => new Map(channels.map((channel) => [channel.id, channel])), [channels]);
  const appMap = useMemo(() => new Map(apps.map((app) => [app.id, app.name])), [apps]);

  async function jsonRequest(url: string, init: RequestInit) {
    const response = await fetch(url, {
      ...init,
      headers: { "Content-Type": "application/json", ...init.headers },
      credentials: "same-origin",
    });
    const payload = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : "No se pudo completar la operación");
    return payload;
  }

  async function createChannel() {
    setBusy("channel-create"); setError(""); setNotice(""); setSigningSecret(null);
    try {
      const payload = await jsonRequest("/api/admin/alerts/channels", {
        method: "POST",
        body: JSON.stringify({ name: channelName, endpoint }),
      });
      const channel = payload.channel as AlertChannel;
      setChannels((current) => [...current, channel]);
      setRuleChannel((current) => current || channel.id);
      setSigningSecret(String(payload.signingSecret || ""));
      setChannelName(""); setEndpoint("");
      setNotice("Canal creado. Copia ahora el secreto de firma: LVL Mail no lo mostrará otra vez.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo crear el canal");
    } finally { setBusy(""); }
  }

  async function toggleChannel(channel: AlertChannel) {
    setBusy(`channel-${channel.id}`); setError(""); setNotice("");
    try {
      const payload = await jsonRequest("/api/admin/alerts/channels", {
        method: "PATCH",
        body: JSON.stringify({ channelId: channel.id, enabled: !channel.is_enabled }),
      });
      const updated = payload.channel as AlertChannel;
      setChannels((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo actualizar el canal"); }
    finally { setBusy(""); }
  }

  async function createRule() {
    setBusy("rule-create"); setError(""); setNotice("");
    try {
      const payload = await jsonRequest("/api/admin/alerts/rules", {
        method: "POST",
        body: JSON.stringify({
          name: ruleName,
          channelId: ruleChannel,
          appId: ruleApp || null,
          incidentType: incidentType || null,
          minSeverity,
          notifyOpen,
          notifyEscalation,
          notifyRecovery,
          cooldownSeconds: 300,
        }),
      });
      const rule = payload.rule as AlertRule;
      setRules((current) => [...current, rule]);
      setRuleName(""); setIncidentType("");
      setNotice("Regla creada. Los siguientes eventos de incidente que coincidan entrarán a la cola de alertas.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo crear la regla"); }
    finally { setBusy(""); }
  }

  async function toggleRule(rule: AlertRule) {
    setBusy(`rule-${rule.id}`); setError(""); setNotice("");
    try {
      const payload = await jsonRequest("/api/admin/alerts/rules", {
        method: "PATCH",
        body: JSON.stringify({ ruleId: rule.id, enabled: !rule.is_enabled }),
      });
      const updated = payload.rule as AlertRule;
      setRules((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo actualizar la regla"); }
    finally { setBusy(""); }
  }

  return <>
    {error && <div className="control-alert error"><strong>Alerting</strong><span>{error}</span></div>}
    {notice && <div className="control-alert success-note"><strong>Listo</strong><span>{notice}</span></div>}
    {signingSecret && <section className="panel" style={{border:"1px solid #f59e0b"}}><div className="panel-head"><div><span className="eyebrow">SECRETO DE FIRMA · UNA SOLA VEZ</span><h2>Guárdalo ahora</h2></div><span className="pill warning">No recuperable</span></div><p className="help-text">El receptor debe usar este secreto para verificar <code>X-LVL-Mail-Signature</code>.</p><code className="tracking-id">{signingSecret}</code><div style={{marginTop:12}}><button className="secondary-button" onClick={() => navigator.clipboard.writeText(signingSecret)}>Copiar secreto</button></div></section>}

    <section className="two-col">
      <article className="panel"><div className="panel-head"><div><span className="eyebrow">CHANNELS</span><h2>Canales</h2></div><span className="pill neutral">{channels.length}</span></div>
        <div className="rule-list">{channels.map((channel) => <div className="rule-row" key={channel.id}><div><span className="rule-label">Canal</span><strong>{channel.name}</strong></div><div><span className="rule-label">Tipo</span><strong>{channel.channel_type === "in_app" ? "In-app" : "Webhook"}</strong></div><div><span className={channel.is_enabled ? "pill success" : "pill neutral"}>{channel.is_enabled ? "Activo" : "Pausado"}</span></div>{canManage && channel.channel_type !== "in_app" ? <button className="secondary-button compact" disabled={Boolean(busy)} onClick={() => toggleChannel(channel)}>{channel.is_enabled ? "Pausar" : "Activar"}</button> : <span/>}</div>)}</div>
        {canManage && <div style={{marginTop:20}}><span className="eyebrow">NUEVO WEBHOOK</span><div className="field-pair"><label className="field"><span>Nombre</span><input value={channelName} onChange={(event) => setChannelName(event.target.value)} placeholder="On-call webhook"/></label><label className="field"><span>Endpoint HTTPS</span><input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://alerts.example.com/lvl-mail"/></label></div><button className="button" disabled={!encryptionReady || !channelName || !endpoint || Boolean(busy)} onClick={createChannel}>{busy === "channel-create" ? "Creando…" : "Crear webhook firmado"}</button>{!encryptionReady && <p className="help-text">Configura <code>LVL_MAIL_ALERT_ENCRYPTION_KEY</code> para crear canales externos.</p>}</div>}
      </article>

      <article className="panel"><div className="panel-head"><div><span className="eyebrow">ROUTING RULES</span><h2>Reglas</h2></div><span className="pill neutral">{rules.length}</span></div>
        <div className="rule-list">{rules.map((rule) => <div className="rule-row" key={rule.id}><div><span className="rule-label">Regla</span><strong>{rule.name}</strong></div><div><span className="rule-label">Destino</span><strong>{channelMap.get(rule.channel_id)?.name ?? rule.channel_id.slice(0,8)}</strong></div><div><span className="rule-label">Scope</span><strong>{rule.app_id ? appMap.get(rule.app_id) ?? rule.app_id : "Todas las apps"}</strong></div><div><span className={rule.is_enabled ? "pill success" : "pill neutral"}>{rule.is_enabled ? rule.min_severity : "Pausada"}</span></div>{canManage ? <button className="secondary-button compact" disabled={Boolean(busy)} onClick={() => toggleRule(rule)}>{rule.is_enabled ? "Pausar" : "Activar"}</button> : <span/>}</div>)}</div>
        {canManage && <div style={{marginTop:20}}><span className="eyebrow">NUEVA REGLA</span><label className="field"><span>Nombre</span><input value={ruleName} onChange={(event) => setRuleName(event.target.value)} placeholder="Críticos de NexMesa → On-call"/></label><div className="field-pair"><label className="field"><span>Canal</span><select value={ruleChannel} onChange={(event) => setRuleChannel(event.target.value)}>{channels.filter((channel) => channel.is_enabled).map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}</select></label><label className="field"><span>Aplicación</span><select value={ruleApp} onChange={(event) => setRuleApp(event.target.value)}><option value="">Todas</option>{apps.map((app) => <option key={app.id} value={app.id}>{app.name}</option>)}</select></label></div><div className="field-pair"><label className="field"><span>Incident type (opcional)</span><input value={incidentType} onChange={(event) => setIncidentType(event.target.value)} placeholder="p0_delivery_degraded"/></label><label className="field"><span>Severidad mínima</span><select value={minSeverity} onChange={(event) => setMinSeverity(event.target.value as "warning" | "critical")}><option value="warning">Warning</option><option value="critical">Critical</option></select></label></div><div className="check-grid"><label><input type="checkbox" checked={notifyOpen} onChange={(event) => setNotifyOpen(event.target.checked)}/> Al abrir</label><label><input type="checkbox" checked={notifyEscalation} onChange={(event) => setNotifyEscalation(event.target.checked)}/> Al escalar</label><label><input type="checkbox" checked={notifyRecovery} onChange={(event) => setNotifyRecovery(event.target.checked)}/> Al recuperar</label></div><button className="button" disabled={!ruleName || !ruleChannel || Boolean(busy)} onClick={createRule}>{busy === "rule-create" ? "Creando…" : "Crear regla"}</button></div>}
      </article>
    </section>

    {canManage && <section className="panel"><div className="panel-head"><div><span className="eyebrow">DELIVERY QUEUE</span><h2>Entregas recientes</h2></div><span className="pill neutral">{recentDeliveries.length}</span></div>{recentDeliveries.length === 0 ? <p className="help-text">Sin entregas de alertas todavía.</p> : <div className="message-ledger"><div className="message-row message-head"><span>Estado</span><span>Canal</span><span>Evento</span><span>Intentos</span><span>Creado</span><span/></div>{recentDeliveries.map((delivery) => <div className="message-row" key={delivery.id}><span><span className={`status-badge ${delivery.status}`}>{delivery.status}</span></span><strong>{delivery.mail_alert_channels?.name ?? "—"}</strong><span>{delivery.mail_alert_events?.title ?? "—"}</span><strong>{delivery.attempts}</strong><time dateTime={delivery.created_at}>{date(delivery.created_at)}</time><span title={delivery.last_error ?? ""}>{delivery.last_error ? "⚠" : "✓"}</span></div>)}</div>}</section>}
  </>;
}
