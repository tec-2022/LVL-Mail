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

class ResendProvider implements MailProvider {
  readonly name = "resend";
  private client: Resend;

  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }

  async send(input: ProviderSendInput): Promise<ProviderSendResult> {
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
  }
}

export function getMailProvider(): MailProvider | null {
  const provider = (process.env.LVL_MAIL_PROVIDER ?? "resend").toLowerCase();
  if (provider === "resend") {
    const apiKey = process.env.RESEND_API_KEY;
    return apiKey ? new ResendProvider(apiKey) : null;
  }
  return null;
}
