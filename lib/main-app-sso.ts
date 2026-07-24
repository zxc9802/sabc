const PRODUCT = 'sabc';
const COOKIE_NAME = 'qycm_sabc_sso';
const MAIN_APP_URL_FALLBACK = 'https://www.qycm.top';
const PUBLIC_SABC_APP_URL = 'https://sabc.qycm.top';

export type MainAppUser = {
  id: string;
  account: string;
  nickname: string;
  role: string;
};

export type MainAppSession = {
  token: string;
  user: MainAppUser;
  expiresAt: number;
};

type ExchangeResponse = {
  success?: boolean;
  data?: {
    token?: unknown;
    redirectPath?: unknown;
    user?: unknown;
    expiresAt?: unknown;
  };
};

function configuredValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function base64UrlEncode(value: Uint8Array): string {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(value: string): Uint8Array | null {
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = `${base64}${'='.repeat((4 - (base64.length % 4)) % 4)}`;
    const binary = atob(padded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return null;
  }
}

function toArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.slice().buffer as ArrayBuffer;
}

async function sessionKey(): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(configuredValue('APP_SESSION_SECRET')),
  );
  return crypto.subtle.importKey(
    'raw',
    digest,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
}

function isMainAppUser(value: unknown): value is MainAppUser {
  if (!value || typeof value !== 'object') return false;
  const user = value as Record<string, unknown>;
  return ['id', 'account', 'nickname', 'role'].every(
    (key) => typeof user[key] === 'string',
  );
}

function isMainAppSession(value: unknown): value is MainAppSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Record<string, unknown>;
  return (
    typeof session.token === 'string' &&
    isMainAppUser(session.user) &&
    typeof session.expiresAt === 'number' &&
    Number.isFinite(session.expiresAt) &&
    session.expiresAt > Date.now()
  );
}

function isFutureExpiration(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > Date.now();
}

export function getMainAppUrl(): string {
  return (process.env.MAIN_APP_URL?.trim() || MAIN_APP_URL_FALLBACK).replace(
    /\/+$/,
    '',
  );
}

export function getPublicSabcAppUrl(): string {
  return PUBLIC_SABC_APP_URL;
}

export function getMainAppSsoLaunchUrl(): string {
  const url = new URL('/home2', getMainAppUrl());
  url.searchParams.set('externalSso', PRODUCT);
  return url.toString();
}

export function getMainAppSessionCookieName(): string {
  return COOKIE_NAME;
}

export function getMainAppSessionCookieOptions(expiresAt?: number) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: expiresAt ? Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)) : 0,
  };
}

export function safeRedirectPath(value: unknown): string {
  if (typeof value !== 'string') return '/';
  const redirectPath = value.trim();
  if (
    !redirectPath ||
    !redirectPath.startsWith('/') ||
    redirectPath.startsWith('//')
  ) {
    return '/';
  }
  return redirectPath;
}

export async function createMainAppSessionCookie(
  session: MainAppSession,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    await sessionKey(),
    toArrayBuffer(new TextEncoder().encode(JSON.stringify(session))),
  );
  return `v1.${base64UrlEncode(iv)}.${base64UrlEncode(
    new Uint8Array(encrypted),
  )}`;
}

export async function readMainAppSessionCookie(
  value: string | undefined,
): Promise<MainAppSession | null> {
  if (!value) return null;
  const [version, ivValue, encryptedValue, extra] = value.split('.');
  if (version !== 'v1' || !ivValue || !encryptedValue || extra) return null;
  const iv = base64UrlDecode(ivValue);
  const encrypted = base64UrlDecode(encryptedValue);
  if (!iv || !encrypted) return null;

  try {
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: toArrayBuffer(iv) },
      await sessionKey(),
      toArrayBuffer(encrypted),
    );
    const session = JSON.parse(new TextDecoder().decode(decrypted));
    return isMainAppSession(session) ? session : null;
  } catch {
    return null;
  }
}

export async function exchangeMainAppSsoTicket(
  ticket: string,
): Promise<{ redirectPath: string; session: MainAppSession }> {
  const response = await fetch(
    process.env.MAIN_APP_SSO_EXCHANGE_URL?.trim() ||
      `${getMainAppUrl()}/api/external-sso/${PRODUCT}/exchange`,
    {
      method: 'POST',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'x-qycm-sso-client-secret': configuredValue(
          'MAIN_APP_SSO_CLIENT_SECRET',
        ),
      },
      body: JSON.stringify({ ticket }),
    },
  );
  const payload = (await response
    .json()
    .catch(() => ({}))) as ExchangeResponse;
  const token = payload.data?.token;
  const user = payload.data?.user;
  const expiresAt = payload.data?.expiresAt;
  if (
    !response.ok ||
    !payload.success ||
    typeof token !== 'string' ||
    !isMainAppUser(user) ||
    !isFutureExpiration(expiresAt)
  ) {
    throw new Error('Main-site SSO exchange was rejected.');
  }

  return {
    redirectPath: safeRedirectPath(payload.data?.redirectPath),
    session: {
      token,
      user,
      expiresAt,
    },
  };
}

export async function validateMainAppSession(
  session: MainAppSession,
): Promise<boolean> {
  try {
    const response = await fetch(`${getMainAppUrl()}/api/sso/session`, {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${session.token}` },
    });
    return response.ok;
  } catch {
    return false;
  }
}
