import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { appBrands, type AppBrand } from "@/lib/mail-policy";
import {
  createStoredMailApp,
  getActiveAppKeyByPrefix,
  getStoredMailApp,
  listStoredMailApps,
  supabaseConfigured,
  touchAppKey,
  type StoredMailApp,
} from "@/lib/supabase-rest";

export type RegisteredApp = AppBrand & {
  websiteUrl: string | null;
  isEnabled: boolean;
  source: "database" | "builtin";
};

function fromStored(row: StoredMailApp): RegisteredApp {
  return {
    id: row.id,
    name: row.name,
    senderLocalPart: row.sender_local_part,
    tagline: row.tagline || row.website_url || "Aplicación conectada a LVL Mail.",
    accent: row.accent || "#111827",
    surface: row.surface || "#f8fafc",
    websiteUrl: row.website_url,
    isEnabled: row.is_enabled,
    source: "database",
  };
}

function fromBuiltin(brand: AppBrand): RegisteredApp {
  return {
    ...brand,
    websiteUrl: null,
    isEnabled: true,
    source: "builtin",
  };
}

export async function listRegisteredApps(): Promise<RegisteredApp[]> {
  if (supabaseConfigured()) {
    try {
      const rows = await listStoredMailApps();
      if (rows.length > 0) return rows.map(fromStored);
    } catch {
      // Keep the control plane useful while persistence is being configured.
    }
  }
  return Object.values(appBrands).map(fromBuiltin);
}

export async function resolveRegisteredApp(appId: string): Promise<RegisteredApp | null> {
  if (supabaseConfigured()) {
    try {
      const stored = await getStoredMailApp(appId);
      if (stored) return fromStored(stored);
    } catch {
      // Built-ins remain available during an observability/database outage.
    }
  }
  const builtin = appBrands[appId];
  return builtin ? fromBuiltin(builtin) : null;
}

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function envKeyFor(appId: string) {
  try {
    const keys = JSON.parse(process.env.LVL_MAIL_APP_KEYS ?? "{}") as Record<string, string>;
    const value = keys[appId];
    return value && value !== "replace-me" ? value : null;
  } catch {
    return null;
  }
}

export async function authenticateRegisteredApp(appId: string, presentedKey: string | null) {
  if (!presentedKey) return false;

  if (supabaseConfigured()) {
    const match = presentedKey.match(/^lvlm_([a-f0-9]{10})_/i);
    if (match) {
      try {
        const keyPrefix = `lvlm_${match[1].toLowerCase()}`;
        const stored = await getActiveAppKeyByPrefix(keyPrefix);
        if (stored?.app_id === appId && safeEqual(stored.secret_hash, hashSecret(presentedKey))) {
          void touchAppKey(stored.id).catch(() => undefined);
          return true;
        }
      } catch {
        // Fall through to the legacy environment key for built-in apps.
      }
    }
  }

  const legacy = envKeyFor(appId);
  return legacy ? safeEqual(legacy, presentedKey) : false;
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32) || "app";
}

function titleFromHost(hostname: string) {
  const clean = hostname.replace(/^www\./, "");
  const first = clean.split(".")[0] || "App";
  return first
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "App";
}

function normalizeWebsiteUrl(value: string) {
  const candidate = /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`;
  const url = new URL(candidate);
  if (!url.hostname || !["http:", "https:"].includes(url.protocol)) throw new Error("Invalid website URL");
  url.hash = "";
  return url.toString();
}

function validAccent(value: string | undefined) {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : "#111827";
}

export async function registerApplication(input: {
  websiteUrl: string;
  name?: string;
  accent?: string;
}) {
  if (!supabaseConfigured()) throw new Error("Persistence is not configured");

  const websiteUrl = normalizeWebsiteUrl(input.websiteUrl);
  const url = new URL(websiteUrl);
  const name = input.name?.trim().slice(0, 80) || titleFromHost(url.hostname);
  const baseId = slugify(name || url.hostname);

  let id = baseId;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const existing = await getStoredMailApp(id);
    if (!existing) break;
    id = `${baseId.slice(0, 27)}-${randomBytes(2).toString("hex")}`;
  }
  if (await getStoredMailApp(id)) throw new Error("Could not allocate application id");

  const token = randomBytes(24).toString("hex");
  const keyPrefix = `lvlm_${token.slice(0, 10)}`;
  const apiKey = `${keyPrefix}_${token.slice(10)}`;
  const senderLocalPart = id.slice(0, 48);
  const accent = validAccent(input.accent);
  const tagline = url.hostname.replace(/^www\./, "");

  const stored = await createStoredMailApp({
    id,
    name,
    senderLocalPart,
    websiteUrl,
    tagline,
    accent,
    surface: "#f8fafc",
    keyPrefix,
    secretHash: hashSecret(apiKey),
  });
  if (!stored) throw new Error("Application creation failed");

  return {
    app: fromStored(stored),
    apiKey,
    sendingDomain: process.env.LVL_MAIL_SENDING_DOMAIN ?? "mail.lvltechmx.com",
  };
}
