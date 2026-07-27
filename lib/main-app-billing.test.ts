import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("main-app credit billing integration", () => {
  it("wraps non-streaming and streaming provider calls", async () => {
    const source = await readFile(
      path.join(process.cwd(), "lib", "ai", "deepseek-client.ts"),
      "utf8",
    );
    const billing = await readFile(
      path.join(process.cwd(), "lib", "main-app-billing.ts"),
      "utf8",
    );
    const reportRoute = await readFile(
      path.join(process.cwd(), "app", "api", "report", "route.ts"),
      "utf8",
    );

    expect(source).toMatch(/reserveProviderCredits\(/);
    expect(source).toMatch(/billing\?\.settle\(parseOpenAiUsage/);
    expect(source).toMatch(/billing\?\.release\(\)/);
    expect(source).toMatch(/preserveReservation/);
    expect(billing).toMatch(/product:\s*"sabc"/);
    expect(billing).toMatch(/x-qycm-sso-client-secret/);
    expect(billing).toMatch(/billing_config/);
    expect(source).toMatch(/userId:\s*this\.billingUserId/);
    expect(reportRoute).toMatch(/currentBillingUserId\(\)/);
    expect(reportRoute).toMatch(/createDeepSeekClientFromEnv\(billingUserId\)/);
  });
});
