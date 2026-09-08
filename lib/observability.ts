import { randomUUID } from "node:crypto";

export type LogLevel = "info" | "warn" | "error";
export type LogContext = Record<string, unknown>;

const sensitiveKey = /(^|_)(authorization|cookie|password|secret|token|api.?key|recipient|email|to|from|html|text|ciphertext|auth.?tag)(_|$)/i;
const requestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/;

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1));
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
      result[key] = sensitiveKey.test(key) ? "[redacted]" : sanitizeValue(item, depth + 1);
    }
    return result;
  }
  return String(value);
}

export function normalizeRequestId(value: string | null | undefined) {
  const candidate = value?.trim();
  return candidate && requestIdPattern.test(candidate) ? candidate : null;
}

export function requestIdFromHeaders(headers: Headers) {
  return normalizeRequestId(headers.get("x-request-id"))
    ?? normalizeRequestId(headers.get("x-vercel-id"))
    ?? randomUUID();
}

export function logEvent(level: LogLevel, event: string, context: LogContext = {}) {
  const record = {
    timestamp: new Date().toISOString(),
    level,
    service: "lvl-mail",
    event: event.slice(0, 120),
    ...sanitizeValue(context) as Record<string, unknown>,
  };
  const line = JSON.stringify(record);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
