import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { afterEach, test, vi } from 'vitest';
import { createMainAppSessionCookie } from './main-app-sso';
import { proxy } from '../proxy';
import { GET } from '../app/api/sso/session/route';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function setup() {
  let now = 1_800_000_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.stubEnv('APP_SESSION_SECRET', 'test-session-secret');
  const value = await createMainAppSessionCookie({
    token: crypto.randomUUID(),
    user: { id: 'test-user', account: 'test', nickname: 'Test', role: 'member' },
    expiresAt: now + 7 * 86_400_000,
  });
  return {
    advance: (ms: number) => { now += ms; },
    request: (path = '/api/projects', cookie = value) => new NextRequest(new URL(path, 'https://tool.example'), {
      headers: { cookie: `qycm_sabc_sso=${cookie}` },
    }),
  };
}

for (const failure of [429, 500, 502, 503, 'network', 'timeout']) {
  test('preserves the cookie and blocks requests during ' + failure, async () => {
    const { request, advance } = await setup();
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 200 }));
    assert.equal((await proxy(request())).status, 200);
    advance(31_000);
    vi.stubGlobal('fetch', async () => {
      if (failure === 'network') throw new TypeError('fetch failed');
      if (failure === 'timeout') throw new DOMException('timed out', 'TimeoutError');
      return new Response('{}', { status: Number(failure) });
    });
    for (const response of [await proxy(request()), await proxy(request('/')), await GET(request('/api/sso/session'))]) {
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('set-cookie'), null);
      assert.equal(response.headers.get('location'), null);
      assert.equal(response.headers.get('retry-after'), '5');
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.match(await response.text(), /稍后.*重试/);
    }
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 200 }));
    assert.equal((await proxy(request())).status, 200);
    assert.equal((await GET(request('/api/sso/session'))).status, 200);
  });
}

for (const status of [401, 403]) {
  test('rejects revoked or disabled sessions: ' + status, async () => {
    const { request } = await setup();
    vi.stubGlobal('fetch', async () => new Response('{}', { status }));
    for (const response of [await proxy(request()), await GET(request('/api/sso/session'))]) {
      assert.equal(response.status, 401);
      assert.match(response.headers.get('set-cookie') ?? '', /Max-Age=0/);
    }
    assert.equal((await proxy(request('/'))).status, 307);
  });
}

test('expired or missing cookies are rejected without reaching the upstream', async () => {
  const { request, advance } = await setup();
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  advance(8 * 86_400_000);
  assert.equal((await proxy(request())).status, 401);
  assert.equal((await GET(request('/api/sso/session'))).status, 401);
  assert.equal((await proxy(request('/api/projects', ''))).status, 401);
  assert.equal(fetchMock.mock.calls.length, 0);
});
