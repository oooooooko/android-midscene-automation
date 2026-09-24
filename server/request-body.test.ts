import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import { PassThrough } from 'node:stream';
import { readBody, readRawBody, requestErrorStatus } from './request-body';

test('malformed JSON returns 400 and subsequent requests remain healthy', async () => {
  const server = createServer(async (req, res) => {
    try { res.end(JSON.stringify(await readBody(req))); }
    catch (error) { res.statusCode = requestErrorStatus(error); res.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const url = `http://127.0.0.1:${address.port}`;
    for (const body of ['{', 'null', '[]', '123']) assert.equal((await fetch(url, { method: 'POST', body })).status, 400);
    const response = await fetch(url, { method: 'POST', body: '{"ok":true}' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('body limits cover content-length and streamed chunks; aborts reject without crashing', async () => {
  for (const useLength of [true, false]) {
    const stream = new PassThrough();
    const req = Object.assign(stream, { headers: useLength ? { 'content-length': '9' } : {} }) as unknown as IncomingMessage;
    const promise = readRawBody(req, 8);
    const rejected = assert.rejects(promise, error => requestErrorStatus(error) === 413);
    if (!useLength) { stream.write('1234'); stream.write('56789'); }
    await rejected;
    stream.end();
  }
  const stream = Object.assign(new PassThrough(), { headers: {} });
  const rejected = assert.rejects(readRawBody(stream as unknown as IncomingMessage), error => requestErrorStatus(error) === 400);
  stream.emit('aborted');
  stream.emit('error', new Error('ECONNRESET'));
  await rejected;
  stream.destroy();
});
