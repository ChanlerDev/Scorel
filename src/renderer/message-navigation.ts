export type SearchNavigationTarget = {
  sessionId: string;
  messageId: string;
  nonce: number;
};

export function hasPendingSearchNavigationTarget(
  target: SearchNavigationTarget | null,
  lastHandledNonce: number | null,
): boolean {
  return target != null && target.nonce !== lastHandledNonce;
}
