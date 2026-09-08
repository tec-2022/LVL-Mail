import { recipientHash, supabaseConfigured } from "@/lib/supabase-rest";
import type { TrackedEvent, TrackedMessage, TrackingStatus } from "@/lib/mail-tracking";
import { recoveryConfigured } from "@/lib/recovery-envelope";

export type MessageSearchFilters = {
  query?: string;
  appId?: string;
  templateKey?: string;
  status?: string;
  providerName?: string;
  recipient?: string;
  from?: string;
  to?: string;
  limit?: number;
};

export type ReplayContext = {
  recoveryAvailable: boolean;
  recoveryExpiresAt: string | null;
  alreadyReplayed: boolean;
  replayMessageId: string | null;
};

export type Diagnostic = {
  severity: "success" | "info" | "warning" | "critical";
  title: string;
  explanation: string;
  action: string;
  code: string;
};

export type ReplayDecision = {
  allowed: boolean;
  code: string;
  label: string;
  explanation: string;
};

function config() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && serviceRoleKey ? { url, serviceRoleKey } : null;
}

async function request<T>(path: string, init: RequestInit = {}) {
  const current = config();
  if (!current) throw new Error("Search & Recovery persistence is not configured");
  const response = await fetch(`${current.url}${path}`, {
    ...init,
    headers: {
      apikey: current.serviceRoleKey,
      Authorization: `Bearer ${current.serviceRoleKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...init.headers,
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Search & Recovery failed (${response.status}): ${detail.slice(0, 240)}`);
  }
  if (response.status === 204 || response.headers.get("content-length") === "0") return null as T;
  return await response.json() as T;
}

function normalizedDate(value?: string, endOfDay = false) {
  if (!value) return null;
  const suffix = endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z";
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}${suffix}` : value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function searchTrackedMessages(filters: MessageSearchFilters): Promise<TrackedMessage[]> {
  if (!supabaseConfigured()) return [];
  try {
    const rows = await request<TrackedMessage[]>("/rest/v1/rpc/mail_search_messages", {
      method: "POST",
      body: JSON.stringify({
        p_query: filters.query?.trim() || null,
        p_app_id: filters.appId?.trim() || null,
        p_template_key: filters.templateKey?.trim() || null,
        p_status: filters.status?.trim() || null,
        p_provider_name: filters.providerName?.trim() || null,
        p_recipient_hash: filters.recipient?.trim() ? recipientHash(filters.recipient) : null,
        p_from: normalizedDate(filters.from),
        p_to: normalizedDate(filters.to, true),
        p_limit: Math.min(Math.max(filters.limit ?? 100, 1), 200),
      }),
    });
    return rows ?? [];
  } catch {
    return [];
  }
}

export async function getReplayContext(messageId: string): Promise<ReplayContext> {
  if (!supabaseConfigured()) {
    return { recoveryAvailable: false, recoveryExpiresAt: null, alreadyReplayed: false, replayMessageId: null };
  }
  try {
    const [envelopes, audits] = await Promise.all([
      request<Array<{ expires_at: string }>>(
        `/rest/v1/mail_recovery_envelopes?message_id=eq.${encodeURIComponent(messageId)}&select=expires_at&limit=1`,
      ),
      request<Array<{ replay_message_id: string }>>(
        `/rest/v1/mail_replay_audit?source_message_id=eq.${encodeURIComponent(messageId)}&select=replay_message_id&limit=1`,
      ),
    ]);
    const expiry = envelopes[0]?.expires_at ?? null;
    const recoveryAvailable = Boolean(
      recoveryConfigured() && expiry && new Date(expiry).getTime() > Date.now(),
    );
    return {
      recoveryAvailable,
      recoveryExpiresAt: expiry,
      alreadyReplayed: Boolean(audits[0]),
      replayMessageId: audits[0]?.replay_message_id ?? null,
    };
  } catch {
    return { recoveryAvailable: false, recoveryExpiresAt: null, alreadyReplayed: false, replayMessageId: null };
  }
}

export async function claimReplay(input: {
  sourceMessageId: string;
  replayMessageId: string;
  actor: string;
  reason: string;
}) {
  const result = await request<boolean>("/rest/v1/rpc/mail_claim_replay", {
    method: "POST",
    body: JSON.stringify({
      p_source_message_id: input.sourceMessageId,
      p_replay_message_id: input.replayMessageId,
      p_actor: input.actor.slice(0, 120),
      p_reason: input.reason.slice(0, 500),
    }),
  });
  return Boolean(result);
}

export function getReplayDecision(message: TrackedMessage, context: ReplayContext): ReplayDecision {
  if (message.replay_of_message_id) {
    return {
      allowed: false,
      code: "replay_chain_blocked",
      label: "Replay no disponible",
      explanation: "Este correo ya es un replay. LVL Mail no permite cadenas de reintentos automáticos.",
    };
  }
  if (message.priority === "P0") {
    return {
      allowed: false,
      code: "fresh_security_intent_required",
      label: "Generar un intento nuevo",
      explanation: "Los correos de seguridad nunca reutilizan OTP, enlaces de confirmación ni tokens de recuperación. La aplicación origen debe emitir credenciales nuevas.",
    };
  }
  if (!new Set(["transactional-notice", "notification"]).has(message.template_key)) {
    return {
      allowed: false,
      code: "template_not_replayable",
      label: "Replay no disponible",
      explanation: "Esta plantilla no está dentro de las categorías aprobadas para recuperación exacta.",
    };
  }
  if (context.alreadyReplayed) {
    return {
      allowed: false,
      code: "already_replayed",
      label: "Ya recuperado",
      explanation: "El correo origen ya generó un replay. Se bloquean repeticiones adicionales para evitar duplicados.",
    };
  }
  if (!new Set<TrackingStatus>(["provider_rejected", "failed"]).has(message.status)) {
    return {
      allowed: false,
      code: "status_not_replayable",
      label: "Replay no recomendado",
      explanation: "Solo se recuperan correos con rechazo definitivo del proveedor o fallo de entrega. Estados aceptados, enviados, retrasados, entregados, rebotados, complaints y supresiones no se duplican.",
    };
  }
  if (!context.recoveryAvailable) {
    return {
      allowed: false,
      code: "recovery_payload_unavailable",
      label: "Payload no disponible",
      explanation: "La copia cifrada de recuperación no existe, expiró o la clave de recuperación no está configurada.",
    };
  }
  return {
    allowed: true,
    code: "safe_replay_available",
    label: "Reenviar de forma segura",
    explanation: "LVL Mail puede crear un correo nuevo, con tracking e idempotencia propios, reutilizando únicamente el payload cifrado vigente.",
  };
}

function latestEvent(events: TrackedEvent[], type: string) {
  return [...events].reverse().find((event) => event.event_type === type) ?? null;
}

export function diagnoseMessage(message: TrackedMessage, events: TrackedEvent[]): Diagnostic {
  if (message.status === "delivered") {
    return {
      severity: "success",
      code: "delivered",
      title: "El proveedor confirmó la entrega",
      explanation: "LVL Mail recibió un evento delivered asociado a este tracking ID.",
      action: "No requiere recuperación. Si el usuario no lo ve, revisar spam, reglas del buzón o filtros del destinatario.",
    };
  }
  if (message.status === "complained") {
    return {
      severity: "critical",
      code: "complaint",
      title: "El destinatario marcó el correo como spam",
      explanation: "Este destinatario debe permanecer suprimido. Reenviar dañaría la reputación compartida de mail.lvltechmx.com.",
      action: "No reenviar. Revisar consentimiento, contenido y frecuencia de la aplicación propietaria.",
    };
  }
  if (message.status === "suppressed") {
    return {
      severity: "critical",
      code: "suppressed",
      title: "El proveedor suprimió al destinatario",
      explanation: "El envío fue detenido por una supresión conocida o una señal de entregabilidad previa.",
      action: "No reenviar hasta resolver la causa de la supresión fuera de LVL Mail.",
    };
  }
  if (message.status === "bounced") {
    const bounce = latestEvent(events, "email.bounced")?.payload as { bounce?: { type?: string | null; subType?: string | null } } | undefined;
    const detail = bounce?.bounce?.type ? ` Tipo: ${bounce.bounce.type}${bounce.bounce.subType ? ` / ${bounce.bounce.subType}` : ""}.` : "";
    return {
      severity: "critical",
      code: "bounced",
      title: "El correo rebotó",
      explanation: `El servidor de destino no aceptó o no pudo entregar el mensaje.${detail}`,
      action: "No usar Safe Replay. Validar la dirección y, si el bounce fue permanente, mantenerla suprimida.",
    };
  }
  if (message.status === "provider_rejected") {
    return {
      severity: "warning",
      code: message.failure_code || "provider_rejected",
      title: "El proveedor rechazó el intento antes de aceptarlo",
      explanation: `LVL Mail conserva el intento y su aplicación propietaria. Motivo: ${message.failure_code || "sin código específico"}.`,
      action: "Corregir la causa del rechazo. Si la plantilla y el recovery envelope lo permiten, usar Safe Replay una sola vez.",
    };
  }
  if (message.status === "failed") {
    return {
      severity: "warning",
      code: message.failure_code || "failed",
      title: "El proveedor aceptó el mensaje pero la entrega terminó en fallo",
      explanation: "Existe trazabilidad del intento original y el mensaje no llegó a estado delivered.",
      action: "Revisar el evento de fallo. Safe Replay solo estará habilitado para plantillas no críticas y con payload cifrado vigente.",
    };
  }
  if (message.status === "delayed") {
    return {
      severity: "info",
      code: "delivery_delayed",
      title: "La entrega sigue en curso",
      explanation: "El proveedor notificó un retraso, no un fallo definitivo. Reenviar ahora podría producir duplicados.",
      action: "Esperar el evento final delivered o failed y vigilar el SLO de entrega de la aplicación.",
    };
  }
  if (message.status === "blocked") {
    const map: Record<string, [string, string]> = {
      recipient_suppressed: ["Destinatario suprimido", "No reenviar; resolver primero la supresión."],
      reputation_restricted: ["Reputación de la aplicación restringida", "Corregir bounce/complaint antes de reabrir tráfico no crítico."],
      minute_limit: ["Límite por minuto alcanzado", "Esperar capacidad disponible; no usar replay manual."],
      daily_limit: ["Límite diario alcanzado", "Ajustar la política o esperar el siguiente periodo."],
      p0_capacity_reserved: ["Capacidad reservada para P0", "El tráfico no crítico cedió capacidad a autenticación. Reintentar desde la app después."],
      app_paused: ["Aplicación pausada", "Reactivar la aplicación solo después de revisar el motivo operativo."],
      template_disabled: ["Plantilla deshabilitada", "Habilitar la plantilla en el control center si corresponde."],
      test_recipient_not_allowed: ["Destinatario no permitido en Test", "Usar un dominio autorizado o cambiar a Live de forma deliberada."],
      policy_unavailable: ["Política de entrega no disponible", "Revisar persistencia/control plane antes de reintentar."],
      template_attribution_failed: ["No se pudo fijar la versión de plantilla", "Resolver persistencia antes de enviar; LVL Mail bloqueó el correo para preservar auditoría."],
    };
    const [title, action] = map[message.failure_code ?? ""] ?? ["LVL Mail bloqueó el envío", "Revisar el código de bloqueo antes de intentar nuevamente desde la aplicación origen."];
    return {
      severity: "warning",
      code: message.failure_code || "blocked",
      title,
      explanation: `El correo nunca llegó al proveedor. Código: ${message.failure_code || "policy_blocked"}.`,
      action,
    };
  }
  if (message.status === "processing") {
    const ageMs = Date.now() - new Date(message.created_at).getTime();
    return ageMs > 5 * 60_000
      ? {
          severity: "critical",
          code: "stuck_processing",
          title: "El intento parece atascado antes del proveedor",
          explanation: "Lleva más de cinco minutos en processing sin resolución posterior.",
          action: "Revisar control plane, persistencia y logs de la solicitud antes de generar un nuevo intento.",
        }
      : {
          severity: "info",
          code: "processing",
          title: "LVL Mail está procesando el intento",
          explanation: "Todavía no existe un resultado definitivo.",
          action: "Esperar la transición a accepted, blocked o provider_rejected.",
        };
  }
  if (message.status === "accepted" || message.status === "sent") {
    return {
      severity: "info",
      code: message.status,
      title: message.status === "accepted" ? "El proveedor aceptó el correo" : "El proveedor inició el envío",
      explanation: "Aún no existe confirmación delivered ni fallo definitivo.",
      action: "No reenviar. Esperar el webhook final y vigilar la latencia de entrega.",
    };
  }
  return {
    severity: "info",
    code: message.status,
    title: "Estado en seguimiento",
    explanation: "LVL Mail conserva el historial completo de este intento.",
    action: "Revisar el timeline antes de tomar una acción manual.",
  };
}
