"use client";

import { useEffect, useMemo, useState } from "react";
import type { TemplateCopy, TemplateDefinition, TemplateVersion } from "@/lib/template-studio";

type Props = {
  appId: string;
  appName: string;
  templateKey: string;
  definition: TemplateDefinition;
  initialCopy: TemplateCopy;
  initialVersions: TemplateVersion[];
  initialPreviewHtml: string;
  initialPreviewSubject: string;
};

type PreviewMode = "desktop" | "mobile";

function date(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Tijuana",
  }).format(new Date(value));
}

export function TemplateStudioEditor({
  appId,
  appName,
  templateKey,
  definition,
  initialCopy,
  initialVersions,
  initialPreviewHtml,
  initialPreviewSubject,
}: Props) {
  const [copy, setCopy] = useState(initialCopy);
  const [versions, setVersions] = useState(initialVersions);
  const [previewHtml, setPreviewHtml] = useState(initialPreviewHtml);
  const [previewSubject, setPreviewSubject] = useState(initialPreviewSubject);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("desktop");
  const [changeNote, setChangeNote] = useState("");
  const [testRecipient, setTestRecipient] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const draft = useMemo(() => versions.find((version) => version.status === "draft") ?? null, [versions]);

  async function api(action: string, extra: Record<string, unknown> = {}) {
    const response = await fetch(`/api/admin/apps/${encodeURIComponent(appId)}/templates/${encodeURIComponent(templateKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ action, ...extra }),
    });
    const payload = await response.json() as {
      ok?: boolean;
      error?: string;
      errors?: string[];
      html?: string;
      subject?: string;
      versions?: TemplateVersion[];
      trackingId?: string;
    };
    if (!response.ok) throw new Error(payload.errors?.join(" · ") || payload.error || "No se pudo completar la acción");
    return payload;
  }

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const payload = await api("preview", { copy });
        if (payload.html) setPreviewHtml(payload.html);
        if (payload.subject) setPreviewSubject(payload.subject);
        setError("");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Preview inválido");
      }
    }, 450);
    return () => window.clearTimeout(timer);
    // copy is intentionally the only preview dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copy]);

  function field<K extends keyof TemplateCopy>(key: K, value: TemplateCopy[K]) {
    setCopy((current) => ({ ...current, [key]: value }));
    setNotice("");
  }

  async function saveDraft() {
    setBusy("save"); setError(""); setNotice("");
    try {
      const payload = await api("save_draft", { copy, changeNote });
      if (payload.versions) setVersions(payload.versions);
      setNotice("Borrador guardado. Aún no afecta correos en producción.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar"); }
    finally { setBusy(""); }
  }

  async function publish() {
    if (!draft) return;
    setBusy("publish"); setError(""); setNotice("");
    try {
      const payload = await api("publish", { version: draft.version });
      if (payload.versions) setVersions(payload.versions);
      setNotice(`v${draft.version} publicada. Los siguientes correos usarán esta versión.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo publicar"); }
    finally { setBusy(""); }
  }

  async function rollback(version: number) {
    setBusy(`rollback-${version}`); setError(""); setNotice("");
    try {
      const payload = await api("rollback", { version });
      if (payload.versions) setVersions(payload.versions);
      setNotice(`Rollback completado desde v${version}. Se creó una nueva versión publicada.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo hacer rollback"); }
    finally { setBusy(""); }
  }

  async function testSend() {
    setBusy("test"); setError(""); setNotice("");
    try {
      const payload = await api("test_send", { copy, to: testRecipient });
      setNotice(`Correo de prueba aceptado y trackeado: ${payload.trackingId ?? "tracking creado"}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo enviar la prueba"); }
    finally { setBusy(""); }
  }

  return <div className="studio-shell">
    <section className="studio-toolbar">
      <div>
        <span className="eyebrow">{appName.toUpperCase()} · {definition.priority}</span>
        <h2>{definition.name}</h2>
        <p>{definition.description}</p>
      </div>
      <div className="studio-actions">
        <button className="secondary-button" disabled={Boolean(busy)} onClick={saveDraft}>{busy === "save" ? "Guardando…" : "Guardar borrador"}</button>
        <button className="button" disabled={Boolean(busy) || !draft} onClick={publish}>{busy === "publish" ? "Publicando…" : draft ? `Publicar v${draft.version}` : "Sin draft"}</button>
      </div>
    </section>

    {error && <div className="control-alert error"><strong>Revisa la plantilla</strong><span>{error}</span></div>}
    {notice && <div className="control-alert success-note"><strong>Listo</strong><span>{notice}</span></div>}

    <section className="studio-grid">
      <div className="studio-editor">
        <article className="control-panel">
          <div className="panel-head"><div><span className="eyebrow">COPY</span><h3>Contenido editable</h3></div><span className="pill neutral">Sin HTML libre</span></div>
          <label className="field"><span>Asunto</span><input value={copy.subject} maxLength={160} onChange={(event) => field("subject", event.target.value)}/><small>{copy.subject.length}/160</small></label>
          <label className="field"><span>Preheader</span><input value={copy.preheader} maxLength={240} onChange={(event) => field("preheader", event.target.value)}/></label>
          <div className="field-pair"><label className="field"><span>Eyebrow</span><input value={copy.eyebrow} maxLength={80} onChange={(event) => field("eyebrow", event.target.value)}/></label><label className="field"><span>Título</span><input value={copy.title} maxLength={140} onChange={(event) => field("title", event.target.value)}/></label></div>
          <label className="field"><span>Cuerpo</span><textarea rows={6} value={copy.body} maxLength={2000} onChange={(event) => field("body", event.target.value)}/><small>{copy.body.length}/2000</small></label>
          {templateKey !== "otp" && <label className="field"><span>Texto del botón</span><input value={copy.actionLabel} maxLength={80} onChange={(event) => field("actionLabel", event.target.value)}/><small>{templateKey === "verify-email" || templateKey === "password-reset" ? "El botón crítico no puede eliminarse." : "El botón solo aparece cuando la solicitud incluye actionUrl."}</small></label>}
          <label className="field"><span>Nota final</span><textarea rows={3} value={copy.footerNote} maxLength={800} onChange={(event) => field("footerNote", event.target.value)}/></label>
          <label className="field"><span>Nota de cambio</span><input value={changeNote} maxLength={500} onChange={(event) => setChangeNote(event.target.value)} placeholder="Ej. Mejoramos claridad del CTA"/></label>
        </article>

        <article className="control-panel">
          <span className="eyebrow">VARIABLES</span><h3>Contrato de esta plantilla</h3>
          <div className="token-list">{definition.allowedTokens.map((token) => <button key={token} type="button" onClick={() => navigator.clipboard.writeText(`{{${token}}}`)}><code>{`{{${token}}}`}</code><small>Copiar</small></button>)}</div>
          <div className="protected-list"><strong>Estructura protegida por LVL Mail</strong>{definition.protectedStructure.map((item) => <span key={item}>✓ {item}</span>)}</div>
        </article>

        <article className="control-panel">
          <span className="eyebrow">TEST SEND</span><h3>Enviar esta versión de prueba</h3>
          <p className="help-text">Usa datos de muestra, respeta políticas de la app y crea un tracking ID real.</p>
          <div className="studio-test-row"><input type="email" value={testRecipient} onChange={(event) => setTestRecipient(event.target.value)} placeholder="tu@correo.com"/><button className="secondary-button" disabled={Boolean(busy) || !testRecipient} onClick={testSend}>{busy === "test" ? "Enviando…" : "Enviar prueba"}</button></div>
        </article>
      </div>

      <aside className="studio-preview-column">
        <article className="control-panel sticky-preview">
          <div className="panel-head"><div><span className="eyebrow">PREVIEW</span><h3>{previewSubject}</h3></div><div className="preview-switch"><button className={previewMode === "desktop" ? "active" : ""} onClick={() => setPreviewMode("desktop")}>Desktop</button><button className={previewMode === "mobile" ? "active" : ""} onClick={() => setPreviewMode("mobile")}>Móvil</button></div></div>
          <div className={`email-preview-frame ${previewMode}`}><iframe title="Vista previa del correo" sandbox="" srcDoc={previewHtml}/></div>
        </article>
      </aside>
    </section>

    <section className="control-panel studio-history">
      <div className="panel-head"><div><span className="eyebrow">VERSIONES</span><h3>Historial y rollback</h3></div><span className="pill neutral">{versions.length} versiones</span></div>
      {versions.length === 0 ? <p className="help-text">Aún usa la plantilla base de LVL Mail. Guarda el primer borrador para iniciar el historial.</p> : <div className="version-list">{versions.map((version) => <div className="version-row" key={version.id}><div><strong>v{version.version}</strong><span className={`version-state ${version.status}`}>{version.status === "published" ? "Publicada" : version.status === "draft" ? "Draft" : "Archivada"}</span></div><div><span>Creada</span><strong>{date(version.created_at)}</strong></div><div><span>Publicada</span><strong>{date(version.published_at)}</strong></div><div className="version-note">{version.change_note || "Sin nota de cambio"}</div>{version.status === "archived" && <button className="secondary-button compact" disabled={Boolean(busy)} onClick={() => rollback(version.version)}>{busy === `rollback-${version.version}` ? "Restaurando…" : "Restaurar"}</button>}</div>)}</div>}
    </section>
  </div>;
}
