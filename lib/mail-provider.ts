import { Resend } from "resend";

export type ProviderTag = { name: string; value: string };
export type ProviderSendInput = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  headers: Record<string, string>;
  tags: ProviderTag[];
  idempotencyKey: string;
  replyTo?: string | null;
};

export type ProviderSendResult =
  | { ok: true; id: string; provider: string }
  | { ok: false; errorCode: string; provider: string };

export interface MailProvider {
  readonly name: string;
  send(input: ProviderSendInput): Promise<ProviderSendResult>;
}

export type ProviderTopology = {
  primary: string;
  primaryReady: boolean;
  secondary: string | null;
  secondaryReady: boolean;
  failoverMode: "disabled" | "manual";
};

class ResendProvider implements MailProvider {
  readonly name = "resend";
  private client: Resend;

  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }

  async send(input: ProviderSendInput): Promise<ProviderSendResult> {
    try {
      const { data, error } = await this.client.emails.send(
        {
          from: input.from,
          to: [input.to],
          subject: input.subject,
          html: input.html,
          text: input.text,
          headers: input.headers,
          tags: input.tags,
          ...(input.replyTo ? { replyTo: input.replyTo } : {}),
        },
        { idempotencyKey: input.idempotencyKey },
      );

      if (error || !data?.id) {
        const errorCode = error && typeof error === "object" && "name" in error
          ? String(error.name)
          : "provider_rejected";
        return { ok: false, errorCode, provider: this.name };
      }
      return { ok: true, id: data.id, provider: this.name };
    } catch {
      // An exception can be ambiguous (for example, a timeout after the provider
      // accepted a request). LVL Mail deliberately does NOT auto-failover here,
      // because cross-provider idempotency cannot guarantee that the first provider
      // did not already accept the message.
      return { ok: false, errorCode: "provider_transport_unknown", provider: this.name };
    }
  }
}

function normalizedProviderName(value: string | undefined | null) {
  return value?.trim().toLowerCase() || null;
}

function providerConfigured(name: string | null) {
  if (name === "resend") return Boolean(process.env.RESEND_API_KEY);
  return false;
}

export function getMailProvider(providerName?: string | null): MailProvider | null {
  const provider = normalizedProviderName(providerName)
    ?? normalizedProviderName(process.env.LVL_MAIL_PRIMARY_PROVIDER)
    ?? normalizedProviderName(process.env.LVL_MAIL_PROVIDER)
    ?? "resend";

  if (provider === "resend") {
    const apiKey = process.env.RESEND_API_KEY;
    return apiKey ? new ResendProvider(apiKey) : null;
  }
  return null;
}

export function getProviderTopology(): ProviderTopology {
  const primary = normalizedProviderName(process.env.LVL_MAIL_PRIMARY_PROVIDER)
    ?? normalizedProviderName(process.env.LVL_MAIL_PROVIDER)
    ?? "resend";
  const secondaryRaw = normalizedProviderName(process.env.LVL_MAIL_SECONDARY_PROVIDER);
  const secondary = secondaryRaw && secondaryRaw !== primary ? secondaryRaw : null;
  const requestedMode = normalizedProviderName(process.env.LVL_MAIL_FAILOVER_MODE);
  const failoverMode: ProviderTopology["failoverMode"] = requestedMode === "manual" ? "manual" : "disabled";

  return {
    primary,
    primaryReady: providerConfigured(primary),
    secondary,
    secondaryReady: Boolean(secondary && providerConfigured(secondary)),
    failoverMode,
  };
}

export function getReplayProvider(slot: "primary" | "secondary" = "primary") {
  const topology = getProviderTopology();
  const providerName = slot === "secondary" ? topology.secondary : topology.primary;
  if (!providerName) return null;
  return getMailProvider(providerName);
}
