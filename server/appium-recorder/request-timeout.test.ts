import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { ConditionTimeoutError } from './condition-timeout';
import { AppiumRequestTimeoutError, timedAppiumFetch, withElementDeadline } from './request-timeout';

test('element deadline does not shorten an in-flight request or its response body', async () => {
  const server = createServer(async (_req, res) => {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.flushHeaders();
    await delay(150);
    res.end('{"value":{"error":"no such element"}}');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/element`;
  try {
    const result = await withElementDeadline(50, () => timedAppiumFetch(url, {}, 2000));
    assert.equal(result.response.status, 404);
    assert.equal(JSON.parse(result.text).value.error, 'no such element');
    await assert.rejects(withElementDeadline(1, async () => {
      await delay(10);
      return timedAppiumFetch(url, {}, 2000);
    }), ConditionTimeoutError);
    await assert.rejects(withElementDeadline(10, () => timedAppiumFetch(url, {}, 50)), AppiumRequestTimeoutError);
    const controller = new AbortController();
    const request = timedAppiumFetch(url, { signal: controller.signal }, 2000);
    controller.abort(new Error('user stopped'));
    await assert.rejects(request, /user stopped/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
