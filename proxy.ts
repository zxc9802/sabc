import { NextResponse, type NextRequest } from 'next/server';
import {
  getMainAppSessionCookieName,
  getMainAppSessionCookieOptions,
  getMainAppSsoLaunchUrl,
  readMainAppSessionCookie,
  validateMainAppSession,
} from './lib/main-app-sso';

export async function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === '/api/sso/callback') return NextResponse.next();

  const session = await readMainAppSessionCookie(request.cookies.get(getMainAppSessionCookieName())?.value);
  if (session && await validateMainAppSession(session)) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith('/api/')) {
    const response = NextResponse.json(
      { error: 'Main-site session is invalid.' },
      { status: 401 },
    );
    response.cookies.set(getMainAppSessionCookieName(), '', { ...getMainAppSessionCookieOptions(), maxAge: 0 });
    return response;
  }

  const response = NextResponse.redirect(getMainAppSsoLaunchUrl());
  response.cookies.set(getMainAppSessionCookieName(), '', { ...getMainAppSessionCookieOptions(), maxAge: 0 });
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
