export type OriginCheckInput = {
  method?: string | null;
  forwardedHost?: string | null;
  host?: string | null;
  forwardedProto?: string | null;
  proto?: string | null;
  secFetchSite?: string | null;
  origin?: string | null;
  authorization?: string | null;
};

export function expectedOrigin(input: OriginCheckInput): string | null;
export function isTrustedMutation(input: OriginCheckInput): boolean;
