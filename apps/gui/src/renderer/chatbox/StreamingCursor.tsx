export type StreamingCursorProps = {
  testId?: string;
};

export function StreamingCursor({ testId = "streaming-cursor" }: StreamingCursorProps = {}) {
  return <span data-testid={testId} aria-hidden="true" className="streaming-cursor" />;
}
