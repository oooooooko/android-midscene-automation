import { open } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';

// 浏览器按字节加载 MP4；支持 Range 才能直接跳转到录像中间。
export async function sendReplayVideo(req: IncomingMessage, res: ServerResponse, path: string) {
  const file = await open(path, 'r').catch(() => null);
  if (!file) { res.statusCode = 404; res.end('视频文件不存在'); return; }
  let streaming = false;
  try {
    const { size } = await file.stat();
    let start = 0, end = size - 1;
    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match && (match[1] || match[2])) {
        start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
        end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      } else start = size;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
        res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return;
      }
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    }
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Length', String(Math.max(0, end - start + 1)));
    if (req.method === 'HEAD' || !size) { res.end(); return; }
    const stream = file.createReadStream({ start, end });
    streaming = true;
    res.once('close', () => stream.destroy());
    stream.once('error', () => res.destroy());
    stream.pipe(res);
  } finally { if (!streaming) await file.close(); }
}
