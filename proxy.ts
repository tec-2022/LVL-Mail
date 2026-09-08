import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { authProxyConfigured, updateAuthSession } from "@/lib/supabase/auth-proxy";

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

export async function proxy(request: NextRequest) {
  // Break-glass remains usable during IAM bootstrap even after Supabase Auth is
  // configured. This is required to invite/bootstrap the first Owner. Disable
  // it explicitly once staff login has been validated in production.
  if (validBreakGlass(request)) return NextResponse.next({ request });
  if (authProxyConfigured()) return await updateAuthSession(request);
  return legacyBreakGlass(request);
}

export const config = {
  matcher: ["/((?!api(?:/|$)|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
