import { NextRequest } from "next/server";
import { afterEach, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  read: vi.fn(),
  validate: vi.fn(),
}));

vi.mock("@/lib/main-app-sso", () => ({
  getMainAppSessionCookieName: () => "qycm_sabc_sso",
  getMainAppSessionCookieOptions: () => ({ httpOnly: true, path: "/" }),
  readMainAppSessionCookie: mocked.read,
  validateMainAppSession: mocked.validate,
}));

import { isSsoOwner, requireSsoOwner } from "./require-sso-owner";

afterEach(() => {
  mocked.read.mockReset();
  mocked.validate.mockReset();
});

it("derives the storage owner from the validated SSO session", async () => {
  mocked.read.mockResolvedValue({
    token: "main-token",
    user: { id: "user-a", account: "a@example.com", nickname: "A", role: "member" },
    expiresAt: Date.now() + 60_000,
  });
  mocked.validate.mockResolvedValue(true);

  const result = await requireSsoOwner(new NextRequest("https://sabc.example/api/projects"));

  expect(isSsoOwner(result) && result.ownerId).toBe("user-a");
});

it("clears an invalid target session and returns JSON 401", async () => {
  mocked.read.mockResolvedValue(null);

  const result = await requireSsoOwner(new NextRequest("https://sabc.example/api/projects"));

  expect(isSsoOwner(result)).toBe(false);
  if (isSsoOwner(result)) return;
  expect(result.status).toBe(401);
  expect(result.cookies.get("qycm_sabc_sso")?.value).toBe("");
});
