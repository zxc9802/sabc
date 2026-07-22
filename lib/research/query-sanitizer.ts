const CREDENTIAL = /\b(?:as_sk_|sk-)[A-Za-z0-9_-]{8,}\b/giu;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const PHONE = /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/gu;
const MONEY =
  /(?:[¥￥$]\s*\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s*(?:万元|元|美元|人民币|RMB|CNY|USD))/giu;

export function sanitizeResearchQueries(values: string[]): string[] {
  const safe = values
    .map((value) =>
      value
        .replace(CREDENTIAL, " ")
        .replace(EMAIL, " ")
        .replace(PHONE, " ")
        .replace(MONEY, " ")
        .replace(/[\s,，;；|]+/gu, " ")
        .trim(),
    )
    .filter(Boolean);

  return [...new Set(safe)].slice(0, 5);
}
