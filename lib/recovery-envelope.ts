import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import type { TemplateSource } from "@/lib/template-attribution";

export type RecoveryEnvelopePayload = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo: string | null;
  templateKey: string;
  templateSource: TemplateSource;
  templateVersion: number | null;
};

type StoredRecoveryEnvelope = {
  message_id: string;
  ciphertext: string;
  iv: string;
  auth_tag: string;
  expires_at: string;
  created_at: string;
  updated_at: string;
};

function config() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const encodedKey = process.env.LVL_MAIL_RECOVERY_KEY;
  if (!url || !serviceRoleKey || !encodedKey) return null;

  let encryptionKey: Buffer;
  try {
    encryptionKey = Buffer.from(encodedKey, "base64");
  } catch {
    return null;
  }
  if (encryptionKey.length !== 32) return null;
  return { url, serviceRoleKey, encryptionKey };
}

async function request<T>(path: string, init: RequestInit = {}) {
  const current = config();
  if (!current) throw new Error("Recovery encryption is not configured");
  const response = await fetch(`${current.url}${path}`, {
    ...init,
    headers: {
      apikey: current.serviceRoleKey,
      Authorization: `Bearer ${current.serviceRoleKey}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Recovery persistence failed (${response.status}): ${detail.slice(0, 240)}`);
  }
  if (response.status === 204 || response.headers.get("content-length") === "0") return null as T;
  return await response.json() as T;
}

export function recoveryConfigured() {
  return Boolean(config());
}

export function recoveryTtlMinutes(templateKey: string) {
  if (templateKey === "transactional-notice") return 24 * 60;
  if (templateKey === "notification") return 72 * 60;
  return 0;
}

function aad(messageId: string) {
  return Buffer.from(`lvl-mail/recovery/${messageId}`, "utf8");
}

export async function saveRecoveryEnvelope(input: {
  messageId: string;
  payload: RecoveryEnvelopePayload;
}) {
  const current = config();
  const ttlMinutes = recoveryTtlMinutes(input.payload.templateKey);
  if (!current || ttlMinutes <= 0) return false;

  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", current.encryptionKey, iv);
  cipher.setAAD(aad(input.messageId));
  const plaintext = Buffer.from(JSON.stringify(input.payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();

  await request("/rest/v1/mail_recovery_envelopes?on_conflict=message_id", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify({
      message_id: input.messageId,
      ciphertext: ciphertext.toString("base64"),
      iv: iv.toString("base64"),
      auth_tag: authTag.toString("base64"),
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    }),
  });
  return true;
}

export async function getRecoveryEnvelope(messageId: string): Promise<{
  payload: RecoveryEnvelopePayload;
  expiresAt: string;
} | null> {
  const current = config();
  if (!current) return null;

  const rows = await request<StoredRecoveryEnvelope[]>(
    `/rest/v1/mail_recovery_envelopes?message_id=eq.${encodeURIComponent(messageId)}&select=*&limit=1`,
  );
  const row = rows[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await deleteRecoveryEnvelope(messageId).catch(() => undefined);
    return null;
  }

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      current.encryptionKey,
      Buffer.from(row.iv, "base64"),
    );
    decipher.setAAD(aad(messageId));
    decipher.setAuthTag(Buffer.from(row.auth_tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(row.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
    const parsed = JSON.parse(plaintext) as RecoveryEnvelopePayload;
    if (
      !parsed ||
      typeof parsed.to !== "string" ||
      typeof parsed.from !== "string" ||
      typeof parsed.subject !== "string" ||
      typeof parsed.html !== "string" ||
      typeof parsed.text !== "string" ||
      typeof parsed.templateKey !== "string"
    ) return null;
    return { payload: parsed, expiresAt: row.expires_at };
  } catch {
    return null;
  }
}

export async function deleteRecoveryEnvelope(messageId: string) {
  if (!recoveryConfigured()) return;
  await request(`/rest/v1/mail_recovery_envelopes?message_id=eq.${encodeURIComponent(messageId)}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  });
}

export async function purgeExpiredRecoveryEnvelopes() {
  if (!recoveryConfigured()) return 0;
  const result = await request<number>("/rest/v1/rpc/mail_purge_expired_recovery_envelopes", {
    method: "POST",
    body: "{}",
  });
  return Number(result ?? 0);
}
