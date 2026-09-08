import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function adminConfigured() {
  return Boolean(process.env.LVL_MAIL_ADMIN_USER && process.env.LVL_MAIL_ADMIN_PASSWORD);
}

export function authenticateAdminRequest(request: NextRequest) {
  const expectedUser = process.env.LVL_MAIL_ADMIN_USER;
  const expectedPassword = process.env.LVL_MAIL_ADMIN_PASSWORD;
  if (!expectedUser || !expectedPassword) return process.env.NODE_ENV !== "production";

  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Basic ")) return false;

  let decoded = "";
  try {
    decoded = Buffer.from(authorization.slice(6), "base64").toString("utf8");
  } catch {
    return false;
  }

  const separator = decoded.indexOf(":");
  if (separator < 0) return false;
  const user = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  return safeEqual(user, expectedUser) && safeEqual(password, expectedPassword);
}
