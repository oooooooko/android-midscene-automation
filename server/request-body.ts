import type { IncomingMessage } from 'node:http';

export class RequestBodyError extends Error {
  constructor(message: string, readonly statusCode: number) { super(message); }
}

export function requestErrorStatus(error: unknown, fallback = 500) {
  return error instanceof RequestBodyError ? error.statusCode : fallback;
}

export function readRawBody(req: IncomingMessage, limit = 16 * 1024 * 1024): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => fail(new RequestBodyError('请求读取超时', 408)), 30_000);
    const cleanup = () => {
      clearTimeout(timer);
      req.off('data', data); req.off('end', end); req.off('aborted', aborted); req.off('error', fail);
    };
    const fail = (error: Error) => {
      cleanup(); chunks.length = 0;
      // An aborted socket can emit an error after the aborted event.
      req.once('error', () => {});
      req.resume(); reject(error);
    };
    const data = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > limit) { fail(new RequestBodyError('请求内容过大', 413)); return; }
      chunks.push(buffer);
    };
    const end = () => { cleanup(); resolve(Buffer.concat(chunks)); };
    const aborted = () => fail(new RequestBodyError('请求已中断', 400));
    req.on('data', data); req.once('end', end); req.once('aborted', aborted); req.once('error', fail);
    if (Number(req.headers['content-length']) > limit) fail(new RequestBodyError('请求内容过大', 413));
  });
}

export async function readBody<T>(req: IncomingMessage): Promise<T> {
  const body = await readRawBody(req);
  try {
    const value: unknown = JSON.parse(body.toString('utf8') || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as T;
  } catch {
    throw new RequestBodyError('请求必须是有效的 JSON 对象', 400);
  }
}
