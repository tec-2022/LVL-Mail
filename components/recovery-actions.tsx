"use client";

import { useState } from "react";

type Decision = {
  allowed: boolean;
  code: string;
  label: string;
  explanation: string;
};

type Props = {
  messageId: string;
  decision: Decision;
  recoveryExpiresAt: string | null;
  replayMessageId: string | null;
  secondaryReady: boolean;
  manualFailover: boolean;
};

export function RecoveryActions({
  messageId,
  decision,
  recoveryExpiresAt,
  replayMessageId,
  secondaryReady,
  manualFailover,
}: Props) {
  const [reason, setReason] = useState("Recuperación manual después de revisar el diagnóstico");
  const [busy, setBusy] = useState<"primary" | "secondary" | null>(null);
  const [error, setError] = useState("");

  async function replay(providerSlot: "primary" | "secondary") {
    setBusy(providerSlot);
    setError("");
    try {
      const response = await fetch(`/api/admin/messages/${encodeURIComponent(messageId)}/replay`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerSlot, reason }),
      });
      const payload = await response.json() as { error?: string; trackingId?: string };
      if (!response.ok || !payload.trackingId) throw new Error(payload.error || "No se pudo crear el Safe Replay");
      window.location.assign(`/activity/${payload.trackingId}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo crear el Safe Replay");
      setBusy(null);
    }
  }

  if (replayMessageId) {
    return <div className="recovery-action-state done">
      <strong>Este correo ya generó un Safe Replay</strong>
      <span>LVL Mail bloquea un segundo replay del mismo correo origen.</span>
      <a className="secondary-button" href={`/activity/${replayMessageId}`}>Ver replay →</a>
    </div>;
  }

  if (!decision.allowed) {
    return <div className="recovery-action-state blocked">
      <strong>{decision.label}</strong>
      <span>{decision.explanation}</span>
      <code>{decision.code}</code>
    </div>;
  }

  return <div className="recovery-action-state ready">
    <div>
      <strong>{decision.label}</strong>
      <span>{decision.explanation}</span>
      {recoveryExpiresAt && <small>Payload cifrado disponible hasta {new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Tijuana" }).format(new Date(recoveryExpiresAt))}.</small>}
    </div>
    <label className="field">
      <span>Motivo de recuperación</span>
      <input value={reason} maxLength={500} onChange={(event) => setReason(event.target.value)} />
    </label>
    <div className="recovery-buttons">
      <button className="button" disabled={Boolean(busy)} onClick={() => replay("primary")}>{busy === "primary" ? "Creando replay…" : "Safe Replay · proveedor primario"}</button>
      {manualFailover && secondaryReady && <button className="secondary-button" disabled={Boolean(busy)} onClick={() => replay("secondary")}>{busy === "secondary" ? "Cambiando proveedor…" : "Replay con proveedor secundario"}</button>}
    </div>
    {error && <p className="recovery-error">{error}</p>}
  </div>;
}
