type TextBlock = {
  type?: unknown;
  text?: unknown;
};

type ToolResultLike = {
  content?: unknown;
  details?: unknown;
};

export function extractToolText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const result = value as ToolResultLike;
    if (Array.isArray(result.content)) {
      const text = result.content
        .map((block) => {
          const candidate = block as TextBlock;
          return candidate.type === "text" && typeof candidate.text === "string"
            ? candidate.text
            : "";
        })
        .filter(Boolean)
        .join("\n");
      if (text) return text;
    }
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  return "";
}

export function extractToolDetails(value: unknown): unknown {
  if (value && typeof value === "object" && "details" in value) {
    return (value as ToolResultLike).details;
  }
  return undefined;
}
