import { NextRequest, NextResponse } from 'next/server';
import {
  getMainAppSessionCookieName,
  getMainAppSessionCookieOptions,
  readMainAppSessionCookie,
  validateMainAppSession,
} from '@/lib/main-app-sso';

export async function GET(request: NextRequest) {
  const session = await readMainAppSessionCookie(request.cookies.get(getMainAppSessionCookieName())?.value);
  if (session && await validateMainAppSession(session)) {
    return Response.json({ success: true, data: { user: session.user } });
  }

  const response = NextResponse.json({ error: 'Main-site session is invalid.' }, { status: 401 });
  response.cookies.set(getMainAppSessionCookieName(), '', { ...getMainAppSessionCookieOptions(), maxAge: 0 });
  return response;
}
