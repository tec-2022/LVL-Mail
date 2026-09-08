export type OriginGuardInput = {
  method?: string | null;
  origin?: string | null;
  secFetchSite?: string | null;
  authorization?: string | null;
  host?: string | null;
  forwardedHost?: string | null;
  proto?: string | null;
  forwardedProto?: string | null;
};

export function expectedOrigin(input: OriginGuardInput): string | null;
export function isTrustedMutation(input: OriginGuardInput): boolean;
