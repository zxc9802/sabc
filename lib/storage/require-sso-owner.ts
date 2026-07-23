import "server-only";

import { NextRequest, NextResponse } from "next/server";

import {
  getMainAppSessionCookieName,
  getMainAppSessionCookieOptions,
  readMainAppSessionCookie,
  validateMainAppSession,
} from "@/lib/main-app-sso";

export type SsoOwnerResult = { ownerId: string } | NextResponse;

export async function requireSsoOwner(
  request: NextRequest,
): Promise<SsoOwnerResult> {
  const session = await readMainAppSessionCookie(
    request.cookies.get(getMainAppSessionCookieName())?.value,
  );
  if (session && await validateMainAppSession(session)) {
    return { ownerId: session.user.id };
  }

  const response = NextResponse.json(
    { error: "Main-site session is invalid." },
    { status: 401 },
  );
  response.cookies.set(getMainAppSessionCookieName(), "", {
    ...getMainAppSessionCookieOptions(),
    maxAge: 0,
  });
  return response;
}

export function isSsoOwner(
  result: SsoOwnerResult,
): result is { ownerId: string } {
  return "ownerId" in result;
}
