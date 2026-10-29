import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from '../src/account-app.js';
import { tokenDigest } from '../src/security.js';

function testStore() {
  const users = new Map();
  const sessions = new Map();
  const profiles = new Map();
  return {
    users, sessions, profiles,
    async findUser(email) { return [...users.values()].find(user => user.email === email); },
    async findUserById(id) { return users.get(id); },
    async addUser(user) {
      if ([...users.values()].some(existing => existing.email === user.email)) return false;
      users.set(user._id, user);
      return true;
    },
    async saveSession(session) { sessions.set(session._id, session); },
    async findSession(digest, now) {
      const session = sessions.get(digest);
      return session?.expiresAt > now ? session : null;
    },
    async deleteSession(digest) { sessions.delete(digest); },
    async getProfile(id) { return profiles.get(id); },
    async saveProfile(id, value) { profiles.set(id, structuredClone(value)); },
  };
}

test('account API keeps sessions and recommendation profiles private', async t => {
  const store = testStore();
  let now = new Date('2026-10-29T00:00:00Z');
  const server = createApp({ store, now: () => now }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  async function request(path, { method = 'GET', body, token } = {}) {
    const response = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = response.status === 204 ? null : await response.json();
    return { status: response.status, data };
  }
  let alice;
  let bob;
  const password = 'a-long-test-password-42';
  await t.test('registration normalizes email and stores no plain password or bearer token', async () => {
    const result = await request('/v1/auth/register', {
      method: 'POST', body: { name: 'Alice', email: 'ALICE@example.com', password },
    });
    assert.equal(result.status, 201);
    alice = result.data;
    assert.equal(alice.user.email, 'alice@example.com');
    assert.equal(alice.user.password, undefined);
    const user = store.users.get(alice.user.id);
    assert.notEqual(user.password.hash, password);
    assert.ok(store.sessions.has(tokenDigest(alice.token)));
    assert.equal(store.sessions.has(alice.token), false);
  });
  await t.test('wrong credentials fail and the correct password signs in', async () => {
    const wrong = await request('/v1/auth/login', {
      method: 'POST', body: { email: 'alice@example.com', password: 'wrong-test-password-99' },
    });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.data.code, 'invalid_credentials');
    const right = await request('/v1/auth/login', {
      method: 'POST', body: { email: 'alice@example.com', password },
    });
    assert.equal(right.status, 200);
    assert.equal(right.data.user.id, alice.user.id);
  });
  await t.test('profile ownership comes from the session and cannot be overridden in the body', async () => {
    bob = (await request('/v1/auth/register', {
      method: 'POST', body: { name: 'Bob', email: 'bob@example.com', password },
    })).data;
    const profile = { videoBrain: '{"topics":{"horror":1}}', musicBrain: '{"artists":["Example"]}' };
    assert.equal((await request('/v1/profile', { method: 'PUT', body: profile, token: alice.token })).status, 200);
    const read = await request('/v1/profile', { token: alice.token });
    assert.equal(read.data.videoBrain, profile.videoBrain);
    assert.equal((await request('/v1/profile', { token: bob.token })).status, 404);
    const injection = await request('/v1/profile', {
      method: 'PUT', body: { ...profile, userId: alice.user.id }, token: bob.token,
    });
    assert.equal(injection.status, 400);
    assert.equal(store.profiles.has(bob.user.id), false);
  });
  await t.test('malformed profile JSON is rejected without replacing the saved profile', async () => {
    const before = structuredClone(store.profiles.get(alice.user.id));
    const result = await request('/v1/profile', {
      method: 'PUT', token: alice.token, body: { videoBrain: 'not-json', musicBrain: '{}' },
    });
    assert.equal(result.status, 400);
    assert.deepEqual(store.profiles.get(alice.user.id), before);
  });
  await t.test('unauthenticated requests cannot read personal data', async () => {
    assert.equal((await request('/v1/profile')).status, 401);
    assert.equal((await request('/v1/account')).status, 401);
  });
  await t.test('logout revokes the current session immediately', async () => {
    assert.equal((await request('/v1/auth/logout', { method: 'POST', token: bob.token })).status, 204);
    assert.equal((await request('/v1/profile', { token: bob.token })).status, 401);
  });
  await t.test('session expiry is checked even before MongoDB TTL cleanup', async () => {
    now = new Date('2026-12-29T00:00:00Z');
    assert.equal((await request('/v1/account', { token: alice.token })).status, 401);
  });
});

test('invalid registration and repeated auth attempts are bounded', async t => {
  const server = createApp({ store: testStore(), authLimit: 2 }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  const url = 'http://127.0.0.1:' + server.address().port + '/v1/auth/register';
  const statuses = [];
  for (let index = 0; index < 3; index++) {
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"password":"short"}',
    });
    statuses.push(response.status);
    await response.text();
  }
  assert.deepEqual(statuses, [400, 400, 429]);
});
