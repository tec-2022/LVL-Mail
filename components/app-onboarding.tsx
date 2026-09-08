"use client";

import { FormEvent, useMemo, useState } from "react";

type CreatedApp = {
  id: string;
  name: string;
  senderLocalPart: string;
  websiteUrl: string | null;
};

type Result = {
  app: CreatedApp;
  apiKey: string;
  sendingDomain: string;
  templates: string[];
};

export function AppOnboarding() {
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [name, setName] = useState("");
  const [accent, setAccent] = useState("#111827");
  const [advanced, setAdvanced] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const endpoint = typeof window === "undefined" ? "https://mail.lvltechmx.com/api/v1/send" : `${window.location.origin}/api/v1/send`;
  const snippet = useMemo(() => {
    if (!result) return "";
    return `await fetch("${endpoint}", {\n  method: "POST",\n  headers: {\n    "Content-Type": "application/json",\n    "x-lvl-mail-key": process.env.LVL_MAIL_KEY\n  },\n  body: JSON.stringify({\n    appId: "${result.app.id}",\n    template: "verify-email",\n    to: user.email,\n    idempotencyKey: \`verify-\${user.id}\`,\n    variables: {\n      name: user.name,\n      confirmationUrl: confirmationUrl,\n      expiresMinutes: "15"\n    }\n  })\n});`;
  }, [endpoint, result]);

  async function copy(value: string) {
    await navigator.clipboard.writeText(value);
    setMessage("Copiado al portapapeles.");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage(null);
    setResult(null);
    try {
      const response = await fetch("/api/admin/apps", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ websiteUrl, name: name || undefined, accent: advanced ? accent : undefined }),
      });
      const body = await response.json() as { ok?: boolean; error?: string; code?: string } & Partial<Result>;
      if (!response.ok || !body.app || !body.apiKey || !body.sendingDomain || !body.templates) {
        if (body.code === "persistence_not_configured") {
          setMessage("El flujo ya está preparado. Falta conectar la persistencia de LVL Mail para guardar nuevas webs.");
        } else {
          setMessage(body.error || "No se pudo agregar la web.");
        }
        return;
      }
      setResult(body as Result);
    } catch {
      setMessage("No se pudo conectar con LVL Mail.");
    } finally {
      setLoading(false);
    }
  }

  if (result) {
    return <div className="onboarding-result">
      <div className="success-mark">✓</div>
      <span className="eyebrow">WEB AGREGADA</span>
      <h2>{result.app.name} ya está lista</h2>
      <p>LVL Mail creó el remitente, las plantillas base y una clave privada. No necesitas registrar otro dominio en Resend.</p>

      <div className="credential-grid">
        <div><span>App ID</span><strong>{result.app.id}</strong></div>
        <div><span>Remitente</span><strong>{result.app.senderLocalPart}@{result.sendingDomain}</strong></div>
      </div>

      <div className="secret-card">
        <div><span className="eyebrow">CLAVE PRIVADA · SE MUESTRA UNA SOLA VEZ</span><code>{result.apiKey}</code></div>
        <button type="button" className="secondary-button" onClick={() => copy(result.apiKey)}>Copiar clave</button>
      </div>

      <div className="starter-kit">
        <div className="panel-head"><div><span className="eyebrow">INTEGRACIÓN RÁPIDA</span><h3>Primer correo de confirmación</h3></div><button type="button" className="secondary-button" onClick={() => copy(snippet)}>Copiar código</button></div>
        <pre><code>{snippet}</code></pre>
      </div>

      <div className="template-chips">{result.templates.map((template) => <span key={template}>{template}</span>)}</div>
      <button type="button" className="button" onClick={() => { setResult(null); setWebsiteUrl(""); setName(""); }}>Agregar otra web</button>
      {message && <p className="form-message">{message}</p>}
    </div>;
  }

  return <form className="onboarding-form" onSubmit={submit}>
    <div className="onboarding-hero">
      <span className="eyebrow">ALTA RÁPIDA</span>
      <h2>Pega la URL. LVL Mail hace el resto.</h2>
      <p>El nombre, ID, remitente, plantillas y clave se generan automáticamente. Puedes personalizar la marca después.</p>
    </div>

    <label className="field-label">
      <span>URL de la web</span>
      <input autoFocus required type="text" inputMode="url" placeholder="https://miweb.com" value={websiteUrl} onChange={(event) => setWebsiteUrl(event.target.value)} />
      <small>Es el único dato obligatorio.</small>
    </label>

    <label className="field-label">
      <span>Nombre <em>opcional</em></span>
      <input type="text" placeholder="Se detecta desde la URL" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
    </label>

    <button className="advanced-toggle" type="button" onClick={() => setAdvanced((value) => !value)}>{advanced ? "Ocultar personalización" : "Personalizar ahora (opcional)"}</button>
    {advanced && <div className="advanced-panel"><label className="field-label"><span>Color principal</span><div className="color-field"><input type="color" value={accent} onChange={(event) => setAccent(event.target.value)} /><code>{accent}</code></div></label></div>}

    <div className="auto-setup-list">
      <span>LVL Mail configurará automáticamente:</span>
      <div>✓ remitente bajo <code>mail.lvltechmx.com</code></div>
      <div>✓ confirmación, recuperación, OTP y notificaciones</div>
      <div>✓ prioridad P0 para correos de acceso</div>
      <div>✓ clave privada independiente para esta web</div>
    </div>

    <button className="button primary-wide" type="submit" disabled={loading}>{loading ? "Creando…" : "Agregar web"}</button>
    {message && <p className="form-message">{message}</p>}
  </form>;
}
