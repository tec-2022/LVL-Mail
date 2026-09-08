import { NextRequest, NextResponse } from "next/server";
import { authenticateAdminRequest } from "@/lib/admin-auth";
import { registerApplication } from "@/lib/app-registry";
import { supabaseConfigured } from "@/lib/supabase-rest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function error(message: string, status: number, code?: string) {
  return NextResponse.json({ ok: false, error: message, code }, { status });
}

export async function POST(request: NextRequest) {
  if (!authenticateAdminRequest(request)) return error("Unauthorized", 401, "unauthorized");
  if (!supabaseConfigured()) {
    return error("Application persistence is not configured yet", 503, "persistence_not_configured");
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return error("Invalid JSON body", 400, "invalid_json");
  }

  const websiteUrl = typeof body.websiteUrl === "string" ? body.websiteUrl.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : undefined;
  const accent = typeof body.accent === "string" ? body.accent.trim() : undefined;

  if (!websiteUrl || websiteUrl.length > 500) return error("Website URL is required", 400, "website_required");
  if (name && name.length > 80) return error("Application name is too long", 400, "name_too_long");

  try {
    const created = await registerApplication({ websiteUrl, name, accent });
    return NextResponse.json({
      ok: true,
      app: created.app,
      apiKey: created.apiKey,
      sendingDomain: created.sendingDomain,
      templates: ["verify-email", "password-reset", "otp", "transactional-notice", "notification"],
      warning: "Copy this API key now. LVL Mail stores only its hash and cannot show it again.",
    }, { status: 201 });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "Application creation failed";
    return error(message, message.includes("Invalid website") ? 400 : 500, "creation_failed");
  }
}
