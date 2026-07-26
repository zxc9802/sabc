import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

describe('main application SSO regression', () => {
  it('keeps the callback route and authentication proxy in the deployed app', async () => {
    const modulePath = './main-app-sso';
    let sso: typeof import('./main-app-sso') | undefined;
    let importError: unknown;

    try {
      sso = await import(modulePath);
    } catch (error) {
      importError = error;
    }

    expect(importError).toBeUndefined();
    expect(sso).toBeDefined();
    if (!sso) return;

    process.env.APP_SESSION_SECRET = 'sabc-test-session-secret';
    const expiresAt = Date.now() + 60_000;
    const cookie = await sso.createMainAppSessionCookie({
      token: 'main-token',
      user: {
        id: 'user-1',
        account: 'member@example.com',
        nickname: '成员',
        role: 'member',
      },
      expiresAt,
    });

    expect(cookie).not.toContain('main-token');
    await expect(sso.readMainAppSessionCookie(cookie)).resolves.toEqual({
      token: 'main-token',
      user: {
        id: 'user-1',
        account: 'member@example.com',
        nickname: '成员',
        role: 'member',
      },
      expiresAt,
    });
    expect(sso.safeRedirectPath('/report?projectId=p1')).toBe(
      '/report?projectId=p1',
    );
    expect(sso.safeRedirectPath('//outside.example')).toBe('/');
    expect(sso.getPublicSabcAppUrl()).toBe('https://sabc.qycm.top');

    const root = process.cwd();
    const [callback, session, proxy] = await Promise.all([
      readFile(path.join(root, 'app/api/sso/callback/route.ts'), 'utf8'),
      readFile(path.join(root, 'app/api/sso/session/route.ts'), 'utf8'),
      readFile(path.join(root, 'proxy.ts'), 'utf8'),
    ]);

    expect(callback).toMatch(/exchangeMainAppSsoTicket/);
    expect(session).toMatch(/validateMainAppSession/);
    expect(proxy).toMatch(/api\/sso\/callback/);
    expect(proxy).toMatch(/validateMainAppSession/);
  });

  it('keeps the child session until the main-issued token expires', async () => {
    const sso = await import('./main-app-sso');
    process.env.APP_SESSION_SECRET = 'sabc-test-session-secret';
    process.env.MAIN_APP_SSO_CLIENT_SECRET = 'sabc-client-secret';
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({
      success: true,
      data: {
        token: 'main-token',
        redirectPath: '/report',
        expiresAt,
        user: { id: 'user-1', account: 'member@example.com', nickname: '成员', role: 'member' },
      },
    }), { status: 200 })) as typeof fetch;

    try {
      const { session } = await sso.exchangeMainAppSsoTicket('ticket-1');
      expect(session.expiresAt).toBe(expiresAt);
      expect(sso.getMainAppSessionCookieOptions(session.expiresAt).maxAge).toBeGreaterThan(6 * 24 * 60 * 60);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('reuses a successful remote session validation for thirty seconds', async () => {
    const sso = await import('./main-app-sso');
    const originalFetch = globalThis.fetch;
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchImpl as typeof fetch;
    const session = {
      token: `cache-test-${crypto.randomUUID()}`,
      user: {
        id: 'user-1',
        account: 'member@example.com',
        nickname: '成员',
        role: 'member',
      },
      expiresAt: Date.now() + 60_000,
    };

    try {
      await expect(sso.validateMainAppSession(session)).resolves.toBe(true);
      await expect(sso.validateMainAppSession(session)).resolves.toBe(true);
      expect(fetchImpl).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
