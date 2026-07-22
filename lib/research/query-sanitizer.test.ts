import { expect, it } from "vitest";

import { sanitizeResearchQueries } from "./query-sanitizer";

it("removes credentials, contact details, and internal amounts", () => {
  const [query] = sanitizeResearchQueries([
    "跨境电商 boss@example.com 13800138000 sk-secret123456789 as_sk_secret987654321 预算 ¥1,200,000",
  ]);

  expect(query).toContain("跨境电商");
  expect(query).not.toMatch(/boss@example\.com|13800138000|sk-|as_sk_|1,200,000/u);
});

it("deduplicates public queries, removes blanks, and caps the plan at five", () => {
  expect(
    sanitizeResearchQueries([
      "  跨境电商 市场规模  ",
      "跨境电商 市场规模",
      "竞争格局",
      "获客成本",
      "平台政策",
      "物流风险",
      "支付合规",
      "",
    ]),
  ).toEqual([
    "跨境电商 市场规模",
    "竞争格局",
    "获客成本",
    "平台政策",
    "物流风险",
  ]);
});

it("drops a query that contains no public topic after sanitization", () => {
  expect(
    sanitizeResearchQueries(["sk-secret123456789 boss@example.com 13800138000"]),
  ).toEqual([]);
});
