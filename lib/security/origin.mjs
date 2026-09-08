const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function expectedOrigin(input) {
  const host = (input.forwardedHost || input.host || "").split(",")[0].trim();
  if (!host) return null;
  const proto = (input.forwardedProto || input.proto || "https").split(",")[0].trim().replace(/:$/, "");
  if (proto !== "http" && proto !== "https") return null;
  return `${proto}://${host}`;
}

export function isTrustedMutation(input) {
  const method = String(input.method || "GET").toUpperCase();
  if (SAFE_METHODS.has(method)) return true;

  const fetchSite = input.secFetchSite?.trim().toLowerCase() || null;
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") return false;

  const expected = expectedOrigin(input);
  const origin = input.origin?.trim() || null;
  if (origin) {
    if (!expected) return false;
    try {
      return new URL(origin).origin === expected;
    } catch {
      return false;
    }
  }

  // Modern browsers provide Origin and/or Sec-Fetch-Site for unsafe requests.
  // A same-origin Fetch Metadata signal is sufficient when Origin is omitted.
  if (fetchSite === "same-origin") return true;

  // Keep explicit Basic-auth break-glass usable from curl/CLI clients, which do
  // not have browser ambient cookies and therefore are not CSRF-capable.
  if (String(input.authorization || "").startsWith("Basic ")) return true;

  return false;
}
