import { NextRequest, NextResponse } from 'next/server';
import {
  createMainAppSessionCookie,
  exchangeMainAppSsoTicket,
  getMainAppSessionCookieName,
  getMainAppSessionCookieOptions,
  getPublicSabcAppUrl,
} from '@/lib/main-app-sso';

export async function GET(request: NextRequest) {
  const ticket = request.nextUrl.searchParams.get('ticket')?.trim();
  if (!ticket) {
    return Response.json({ error: 'SSO ticket is required.' }, { status: 400 });
  }

  try {
    const { redirectPath, session } = await exchangeMainAppSsoTicket(ticket);
    const response = NextResponse.redirect(
      new URL(redirectPath, getPublicSabcAppUrl()),
    );
    response.cookies.set(
      getMainAppSessionCookieName(),
      await createMainAppSessionCookie(session),
      getMainAppSessionCookieOptions(session.expiresAt),
    );
    return response;
  } catch {
    return Response.json(
      { error: 'Main-site SSO exchange failed.' },
      { status: 401 },
    );
  }
}
