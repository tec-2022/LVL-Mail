import type { TrackedMessage } from "@/lib/mail-tracking";
import { getReplayDecision, type ReplayContext, type ReplayDecision } from "@/lib/search-recovery";

export function getSafeReplayDecision(message: TrackedMessage, context: ReplayContext): ReplayDecision {
  if (message.failure_code === "provider_transport_unknown") {
    return {
      allowed: false,
      code: "ambiguous_provider_outcome",
      label: "Replay bloqueado por seguridad",
      explanation: "La conexión con el proveedor terminó de forma ambigua. No podemos demostrar que el primer proveedor no aceptó el correo, así que un replay o failover podría duplicarlo.",
    };
  }
  return getReplayDecision(message, context);
}
