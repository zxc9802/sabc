import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

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
});
