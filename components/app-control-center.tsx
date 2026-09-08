"use client";

import { useMemo, useState } from "react";
import type { AppKeySummary, AppPolicy, AppTemplateSetting, AuditEntry } from "@/lib/control-plane";

type Props = {
  appId: string;
  appName: string;
  sender: string;
  initialPolicy: AppPolicy;
  initialKeys: AppKeySummary[];
  initialTemplates: AppTemplateSetting[];
  initialAudit: AuditEntry[];
};

type Tab = "overview" | "delivery" | "templates" | "keys" | "integration" | "audit";

type ApiState = {
  policy: AppPolicy;
  keys: AppKeySummary[];
  templates: AppTemplateSetting[];
  audit: AuditEntry[];
};

const templateNames: Record<string, string> = {
  "verify-email": "Confirmar correo",
  "password-reset": "Recuperar contraseña",
  otp: "Código OTP",
  "transactional-notice": "Aviso transaccional",
  notification: "Notificación",
};

function date(value: string | null) {
  if (!value) return "Nunca";
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Tijuana",
  }).format(new Date(value));
}

export function AppControlCenter({
  appId,
  appName,
  sender,
  initialPolicy,
  initialKeys,
  initialTemplates,
  initialAudit,
}: Props) {
  const [tab, setTab] = useState<Tab>("overview");
  const [state, setState] = useState<ApiState>({
    policy: initialPolicy,
    keys: initialKeys,
    templates: initialTemplates,
    audit: initialAudit,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [secret, setSecret] = useState("");
  const [keyLabel, setKeyLabel] = useState("Production");
  const [policyDraft, setPolicyDraft] = useState({
    mode: initialPolicy.mode,
    minuteLimit: initialPolicy.minute_limit,
    dailyLimit: initialPolicy.daily_limit,
    p0ReservedPerMinute: initialPolicy.p0_reserved_per_minute,
    maxConsecutiveFailures: initialPolicy.max_consecutive_failures,
    testRecipientDomains: initialPolicy.test_recipient_domains.join(", "),
  });

  const activeKeys = useMemo(
    () => state.keys.filter((key) => !key.revoked_at && (!key.expires_at || new Date(key.expires_at) > new Date())),
    [state.keys],
  );
  const enabledTemplates = state.templates.filter((template) => template.enabled);

  async function mutate(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/apps/${encodeURIComponent(appId)}/control`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      const payload = await response.json() as Partial<ApiState> & { error?: string; oneTimeApiKey?: string };
      if (!response.ok) throw new Error(payload.error || "No se pudo guardar el cambio");
      setState((current) => ({
        policy: payload.policy ?? current.policy,
        keys: payload.keys ?? current.keys,
        templates: payload.templates ?? current.templates,
        audit: payload.audit ?? current.audit,
      }));
      if (payload.oneTimeApiKey) setSecret(payload.oneTimeApiKey);
      return payload;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar el cambio");
      return null;
    } finally {
      setBusy(false);
    }
  }

  const tabs: Array<[Tab, string]> = [
    ["overview", "Resumen"],
    ["delivery", "Entrega"],
    ["templates", "Plantillas"],
    ["keys", "API Keys"],
    ["integration", "Integración"],
    ["audit", "Auditoría"],
  ];

  return <section className="enterprise-control">
    <nav className="control-tabs" aria-label="Administración de aplicación">
      {tabs.map(([id, label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}
    </nav>

    {error && <div className="control-alert error"><strong>No se pudo aplicar el cambio.</strong><span>{error}</span></div>}
    {secret && <div className="control-alert secret"><div><strong>Nueva API Key</strong><span>Se muestra una sola vez. Guárdala en el servidor de {appName}.</span></div><code>{secret}</code><button onClick={() => navigator.clipboard.writeText(secret)}>Copiar</button><button className="ghost" onClick={() => setSecret("")}>Ocultar</button></div>}

    {tab === "overview" && <div className="control-stack">
      <div className="enterprise-kpis">
        <article><span>Modo</span><strong className={`mode-${state.policy.mode}`}>{state.policy.mode === "live" ? "Live" : state.policy.mode === "test" ? "Test" : "Pausada"}</strong><small>Política efectiva</small></article>
        <article><span>Circuit breaker</span><strong>{state.policy.circuit_state === "closed" ? "Cerrado" : state.policy.circuit_state === "open" ? "Abierto" : "Sondeo"}</strong><small>{state.policy.failure_streak} fallos consecutivos</small></article>
        <article><span>Claves activas</span><strong>{activeKeys.length}</strong><small>Credenciales independientes</small></article>
        <article><span>Plantillas</span><strong>{enabledTemplates.length}/5</strong><small>Habilitadas para esta web</small></article>
      </div>
      <div className="control-grid two">
        <article className="control-panel"><span className="eyebrow">IDENTIDAD</span><h3>{appName}</h3><dl className="control-dl"><div><dt>App ID</dt><dd><code>{appId}</code></dd></div><div><dt>Remitente</dt><dd><code>{sender}</code></dd></div><div><dt>Gateway</dt><dd><code>POST /api/v1/send</code></dd></div></dl></article>
        <article className="control-panel"><span className="eyebrow">GUARDRAILS</span><h3>Protecciones activas</h3><ul className="check-list"><li>Tracking obligatorio antes del proveedor</li><li>Idempotencia por aplicación</li><li>Capacidad P0 reservada</li><li>Rate limits persistentes</li><li>Circuit breaker por web</li><li>Supresión antes de envío</li></ul></article>
      </div>
    </div>}

    {tab === "delivery" && <div className="control-grid two">
      <article className="control-panel"><span className="eyebrow">MODO DE OPERACIÓN</span><h3>Entrega</h3><label className="field"><span>Modo</span><select value={policyDraft.mode} onChange={(event) => setPolicyDraft({ ...policyDraft, mode: event.target.value as AppPolicy["mode"] })}><option value="live">Live — entrega normal</option><option value="test">Test — solo dominios permitidos</option><option value="paused">Pausada — no entrega</option></select></label><label className="field"><span>Dominios permitidos en Test</span><input value={policyDraft.testRecipientDomains} onChange={(event) => setPolicyDraft({ ...policyDraft, testRecipientDomains: event.target.value })} placeholder="resend.dev, lvltechmx.com"/><small>Separados por coma.</small></label></article>
      <article className="control-panel"><span className="eyebrow">RATE LIMITS</span><h3>Capacidad por aplicación</h3><div className="field-pair"><label className="field"><span>Por minuto</span><input type="number" min="1" value={policyDraft.minuteLimit} onChange={(event) => setPolicyDraft({ ...policyDraft, minuteLimit: Number(event.target.value) })}/></label><label className="field"><span>Por día</span><input type="number" min="1" value={policyDraft.dailyLimit} onChange={(event) => setPolicyDraft({ ...policyDraft, dailyLimit: Number(event.target.value) })}/></label></div><div className="field-pair"><label className="field"><span>Reserva P0/min</span><input type="number" min="0" value={policyDraft.p0ReservedPerMinute} onChange={(event) => setPolicyDraft({ ...policyDraft, p0ReservedPerMinute: Number(event.target.value) })}/></label><label className="field"><span>Fallos para abrir circuito</span><input type="number" min="1" value={policyDraft.maxConsecutiveFailures} onChange={(event) => setPolicyDraft({ ...policyDraft, maxConsecutiveFailures: Number(event.target.value) })}/></label></div><button className="button" disabled={busy} onClick={() => mutate({ action: "policy", ...policyDraft, testRecipientDomains: policyDraft.testRecipientDomains.split(",").map((value) => value.trim()).filter(Boolean) })}>{busy ? "Guardando…" : "Guardar política"}</button></article>
      <article className="control-panel full"><span className="eyebrow">CIRCUIT BREAKER</span><h3>Estado actual</h3><div className="breaker-row"><div><span className={`breaker-dot ${state.policy.circuit_state}`}/><strong>{state.policy.circuit_state === "closed" ? "Operación normal" : state.policy.circuit_state === "open" ? "Circuito abierto" : "Half-open / sondeo P0"}</strong><small>Umbral: {state.policy.max_consecutive_failures} fallos consecutivos · streak actual: {state.policy.failure_streak}</small></div><span className="pill neutral">{state.policy.circuit_opened_at ? `Abierto ${date(state.policy.circuit_opened_at)}` : "Sin incidentes"}</span></div></article>
    </div>}

    {tab === "templates" && <div className="control-stack">
      <div className="control-intro"><div><span className="eyebrow">DESIGN SYSTEM</span><h3>Plantillas de {appName}</h3><p>LVL Mail conserva el HTML centralizado. Aquí decides qué flujos puede usar esta web y su configuración operativa.</p></div></div>
      <div className="template-admin-list">{state.templates.map((template) => <TemplateRow key={template.template_key} template={template} busy={busy} onSave={(next) => mutate({ action: "template", templateKey: template.template_key, ...next })}/>)}</div>
    </div>}

    {tab === "keys" && <div className="control-stack">
      <div className="control-grid two"><article className="control-panel"><span className="eyebrow">NUEVA CREDENCIAL</span><h3>Crear API Key</h3><label className="field"><span>Etiqueta</span><input value={keyLabel} onChange={(event) => setKeyLabel(event.target.value)} placeholder="Production"/></label><button className="button" disabled={busy} onClick={() => mutate({ action: "rotate_key", label: keyLabel })}>{busy ? "Creando…" : "Crear nueva clave"}</button><p className="help-text">La clave completa solo aparecerá una vez. En la base guardamos únicamente su hash.</p></article><article className="control-panel"><span className="eyebrow">SEGURIDAD</span><h3>Rotación sin downtime</h3><p className="help-text">Crea primero una nueva clave, actualiza la web y después revoca la anterior. LVL Mail impide revocar la última credencial activa.</p></article></div>
      <article className="control-panel"><div className="panel-head"><div><span className="eyebrow">CREDENCIALES</span><h3>API Keys</h3></div><span className="pill neutral">{activeKeys.length} activas</span></div><div className="key-list">{state.keys.length === 0 ? <p className="help-text">Las claves persistentes aparecerán al conectar la base de datos.</p> : state.keys.map((key) => <div className="key-row" key={key.id}><div><strong>{key.label}</strong><code>{key.key_prefix}_••••••••</code></div><div><span>Último uso</span><strong>{date(key.last_used_at)}</strong></div><div><span>Creada</span><strong>{date(key.created_at)}</strong></div><span className={key.revoked_at ? "pill neutral" : "pill success"}>{key.revoked_at ? "Revocada" : "Activa"}</span>{!key.revoked_at && <button className="danger-link" disabled={busy} onClick={() => mutate({ action: "revoke_key", keyId: key.id })}>Revocar</button>}</div>)}</div></article>
    </div>}

    {tab === "integration" && <div className="control-grid two">
      <article className="control-panel"><span className="eyebrow">ENDPOINT</span><h3>Una integración para cualquier stack</h3><dl className="control-dl"><div><dt>URL</dt><dd><code>https://mail.lvltechmx.com/api/v1/send</code></dd></div><div><dt>Header</dt><dd><code>x-lvl-mail-key</code></dd></div><div><dt>App ID</dt><dd><code>{appId}</code></dd></div></dl><p className="help-text">La API Key debe permanecer exclusivamente en el servidor de tu aplicación.</p></article>
      <article className="control-panel"><span className="eyebrow">JAVASCRIPT / TYPESCRIPT</span><h3>Ejemplo</h3><pre className="integration-code"><code>{`await fetch("https://mail.lvltechmx.com/api/v1/send", {\n  method: "POST",\n  headers: {\n    "Content-Type": "application/json",\n    "x-lvl-mail-key": process.env.LVL_MAIL_KEY\n  },\n  body: JSON.stringify({\n    appId: "${appId}",\n    template: "verify-email",\n    to: user.email,\n    idempotencyKey: \`verify-\${user.id}\`,\n    variables: {\n      name: user.name,\n      confirmationUrl\n    }\n  })\n});`}</code></pre></article>
      <article className="control-panel full"><span className="eyebrow">CONTRATO</span><h3>Lo que LVL Mail garantiza</h3><div className="contract-grid"><span>✓ App autenticada</span><span>✓ Tracking ID antes de enviar</span><span>✓ Prioridad calculada en servidor</span><span>✓ Idempotencia</span><span>✓ Rate limit por web</span><span>✓ Eventos reconciliados</span></div></article>
    </div>}

    {tab === "audit" && <article className="control-panel"><div className="panel-head"><div><span className="eyebrow">AUDIT LOG</span><h3>Cambios administrativos</h3></div><span className="pill neutral">Append-only</span></div>{state.audit.length === 0 ? <p className="help-text">Los cambios aparecerán aquí al conectar la persistencia.</p> : <div className="audit-list">{state.audit.map((entry) => <div className="audit-row" key={entry.id}><span className="audit-dot"/><div><strong>{entry.action}</strong><small>{entry.actor}</small></div><code>{Object.keys(entry.details).length ? JSON.stringify(entry.details) : "{}"}</code><time dateTime={entry.created_at}>{date(entry.created_at)}</time></div>)}</div>}</article>}
  </section>;
}

function TemplateRow({ template, busy, onSave }: { template: AppTemplateSetting; busy: boolean; onSave: (input: { enabled: boolean; locale: string; replyTo: string | null }) => void }) {
  const [enabled, setEnabled] = useState(template.enabled);
  const [locale, setLocale] = useState(template.locale);
  const [replyTo, setReplyTo] = useState(template.reply_to ?? "");
  return <article className="template-admin-row"><div><strong>{templateNames[template.template_key] ?? template.template_key}</strong><code>{template.template_key}</code></div><label className="switch-label"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)}/><span>{enabled ? "Activa" : "Desactivada"}</span></label><label className="compact-field"><span>Idioma</span><input value={locale} onChange={(event) => setLocale(event.target.value)}/></label><label className="compact-field"><span>Reply-To</span><input value={replyTo} onChange={(event) => setReplyTo(event.target.value)} placeholder="Opcional"/></label><button className="secondary-button" disabled={busy} onClick={() => onSave({ enabled, locale, replyTo: replyTo || null })}>Guardar</button></article>;
}
