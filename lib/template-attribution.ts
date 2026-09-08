function config() {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && serviceRoleKey ? { url, serviceRoleKey } : null;
}

async function request(path: string, init: RequestInit = {}) {
  const current = config();
  if (!current) throw new Error("Template attribution persistence is not configured");
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
    throw new Error(`Template attribution failed (${response.status}): ${detail.slice(0, 240)}`);
  }
}

export type TemplateSource = "base" | "published" | "studio_test";

export async function attachTemplateAttribution(input: {
  messageId: string;
  source: TemplateSource;
  version?: number | null;
}) {
  await request("/rest/v1/rpc/mail_set_message_template_attribution", {
    method: "POST",
    body: JSON.stringify({
      p_message_id: input.messageId,
      p_source: input.source,
      p_version: input.version ?? null,
    }),
  });
}
