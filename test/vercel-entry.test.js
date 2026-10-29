import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import app from '../src/app.js';
import { closeDatabase } from '../src/connection.js';

test('Vercel detected app.js exports a request handler and returns a controlled configuration error', async t => {
  assert.equal(typeof app, 'function');
  assert.equal(typeof app.listen, 'function');
  delete process.env.MONGODB_URI;
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await closeDatabase();
  });
  for (const path of ['/', '/health', '/v1/account']) {
    const response = await fetch('http://127.0.0.1:' + server.address().port + path);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { code: 'service_unavailable' });
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});
