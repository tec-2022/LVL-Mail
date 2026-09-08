import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authProxyConfigured, updateAuthSession } from "@/lib/supabase/auth-proxy";
import { isTrustedMutation } from "@/lib/security/origin.mjs";

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function challenge() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="LVL Mail break-glass", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}

function validBreakGlass(request: NextRequest) {
  if (process.env.LVL_MAIL_BREAK_GLASS_ENABLED === "false") return false;
  const expectedUser = process.env.LVL_MAIL_ADMIN_USER;
  const expectedPassword = process.env.LVL_MAIL_ADMIN_PASSWORD;
  if (!expectedUser || !expectedPassword) return false;

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Basic ")) return false;
  try {
    const decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    if (separator < 0) return false;
    return safeEqual(decoded.slice(0, separator), expectedUser) && safeEqual(decoded.slice(separator + 1), expectedPassword);
  } catch {
    return false;
  }
}

function legacyBreakGlass(request: NextRequest) {
  const expectedUser = process.env.LVL_MAIL_ADMIN_USER;
  const expectedPassword = process.env.LVL_MAIL_ADMIN_PASSWORD;

  if (!expectedUser || !expectedPassword) {
    if (process.env.NODE_ENV !== "production") return NextResponse.next({ request });
    return new NextResponse("LVL Mail IAM is not configured", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  if (!validBreakGlass(request)) return challenge();
  return NextResponse.next({ request });
}

function secureApiMutation(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const protectedBoundary = pathname === "/api/admin" || pathname.startsWith("/api/admin/")
    || pathname === "/api/auth" || pathname.startsWith("/api/auth/");
  if (!protectedBoundary) return null;

  const trusted = isTrustedMutation({
    method: request.method,
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
    authorization: request.headers.get("authorization"),
    host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    proto: request.nextUrl.protocol,
    forwardedProto: request.headers.get("x-forwarded-proto"),
  });
  if (trusted) return null;

  return NextResponse.json(
    { ok: false, error: "Untrusted request origin", code: "origin_forbidden" },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const blocked = secureApiMutation(request);
    return blocked ?? NextResponse.next({ request });
  }

  // Break-glass remains usable during IAM bootstrap even after Supabase Auth is
  // configured. Disable it explicitly once staff login has been validated.
  if (validBreakGlass(request)) return NextResponse.next({ request });
  if (authProxyConfigured()) return await updateAuthSession(request);
  return legacyBreakGlass(request);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
