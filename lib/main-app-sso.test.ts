import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  createMainAppSessionCookie,
  getPublicSabcAppUrl,
  readMainAppSessionCookie,
  safeRedirectPath,
} from './main-app-sso';

describe('main application SSO', () => {
  it('encrypts the main token and rejects invalid cookie input', async () => {
    process.env.APP_SESSION_SECRET = 'sabc-test-session-secret';
    const expiresAt = Date.now() + 60_000;
    const cookie = await createMainAppSessionCookie({
      token: 'main-token',
      user: { id: 'user-1', account: 'member@example.com', nickname: '成员', role: 'member' },
      expiresAt,
    });

    expect(cookie).not.toContain('main-token');
    await expect(readMainAppSessionCookie(cookie)).resolves.toEqual({
      token: 'main-token',
      user: { id: 'user-1', account: 'member@example.com', nickname: '成员', role: 'member' },
      expiresAt,
    });
    await expect(readMainAppSessionCookie('invalid')).resolves.toBeNull();
    expect(safeRedirectPath('/report?projectId=p1')).toBe('/report?projectId=p1');
    expect(safeRedirectPath('//outside.example')).toBe('/');
  });

  it('uses the public SABC origin for the post-SSO redirect', () => {
    expect(getPublicSabcAppUrl()).toBe('https://sabc.qycm.top');
  });

  it('keeps the ticket exchange server-side and validates every protected request', async () => {
    const root = process.cwd();
    const [callback, proxy, helper] = await Promise.all([
      readFile(path.join(root, 'app/api/sso/callback/route.ts'), 'utf8'),
      readFile(path.join(root, 'proxy.ts'), 'utf8'),
      readFile(path.join(root, 'lib/main-app-sso.ts'), 'utf8'),
    ]);

    expect(callback).toMatch(/exchangeMainAppSsoTicket/);
    expect(helper).toMatch(/x-qycm-sso-client-secret/);
    expect(helper).toMatch(/httpOnly:\s*true/);
    expect(helper).toMatch(/secure:\s*true/);
    expect(helper).toMatch(/sameSite:\s*["']lax["']/);
    expect(proxy).toMatch(/validateMainAppSession/);
    expect(proxy).toMatch(/api\/sso\/callback/);
  });
});
