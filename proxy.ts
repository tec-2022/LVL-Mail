import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function challenge() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="LVL Mail", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}

export function proxy(request: NextRequest) {
  const expectedUser = process.env.LVL_MAIL_ADMIN_USER;
  const expectedPassword = process.env.LVL_MAIL_ADMIN_PASSWORD;

  if (!expectedUser || !expectedPassword) {
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    return new NextResponse("LVL Mail admin access is not configured", {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Basic ")) return challenge();

  let decoded = "";
  try {
    decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
  } catch {
    return challenge();
  }

  const separator = decoded.indexOf(":");
  if (separator < 0) return challenge();
  const user = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);

  if (!safeEqual(user, expectedUser) || !safeEqual(password, expectedPassword)) {
    return challenge();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api(?:/|$)|_next/static|_next/image|favicon.ico).*)"],
};
