"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function IncidentActions({ incidentId, status }: { incidentId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"acknowledged" | "resolved" | null>(null);
  const [error, setError] = useState("");

  async function update(next: "acknowledged" | "resolved") {
    setBusy(next);
    setError("");
    try {
      const response = await fetch(`/api/admin/incidents/${encodeURIComponent(incidentId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ status: next }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "No se pudo actualizar el incidente");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo actualizar el incidente");
    } finally {
      setBusy(null);
    }
  }

  return <div className="incident-actions">
    {status === "open" && <button className="secondary-button" disabled={Boolean(busy)} onClick={() => update("acknowledged")}>{busy === "acknowledged" ? "Reconociendo…" : "Reconocer incidente"}</button>}
    {status !== "resolved" && <button className="button" disabled={Boolean(busy)} onClick={() => update("resolved")}>{busy === "resolved" ? "Resolviendo…" : "Marcar resuelto"}</button>}
    {error && <span className="incident-action-error">{error}</span>}
  </div>;
}
