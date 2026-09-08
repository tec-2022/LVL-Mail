import { isIP } from "node:net";

function ipv4Parts(address) {
  const parts = address.split(".").map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) ? parts : null;
}

export function isPrivateOrReservedAddress(address) {
  const normalized = String(address || "").trim().toLowerCase();
  if (!normalized) return true;

  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice(7);
    if (isIP(mapped) === 4) return isPrivateOrReservedAddress(mapped);
  }

  const family = isIP(normalized);
  if (family === 4) {
    const parts = ipv4Parts(normalized);
    if (!parts) return true;
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && parts[2] === 2) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && parts[2] === 100) ||
      (a === 203 && b === 0 && parts[2] === 113) ||
      a >= 224
    );
  }

  if (family === 6) {
    if (normalized === "::" || normalized === "::1") return true;
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
    if (/^fe[89ab]/.test(normalized)) return true;
    if (normalized.startsWith("ff")) return true;
    if (normalized.startsWith("2001:db8:")) return true;
    return false;
  }

  return true;
}

export function isForbiddenWebhookHostname(hostname) {
  const value = String(hostname || "").trim().replace(/^\[|\]$/g, "").toLowerCase();
  if (!value) return true;
  if (isIP(value)) return isPrivateOrReservedAddress(value);
  if (!value.includes(".")) return true;
  if (
    value === "localhost" ||
    value.endsWith(".localhost") ||
    value.endsWith(".local") ||
    value.endsWith(".internal") ||
    value.endsWith(".lan") ||
    value.endsWith(".home")
  ) return true;
  return false;
}
