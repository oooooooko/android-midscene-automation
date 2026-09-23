import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { rm } from 'node:fs/promises';
import type { ScrcpyMediaStreamPacket } from '@yume-chan/scrcpy';
import { ReplayMp4Writer } from './replay-mp4';
import type { ReplayVideo } from './replay-video';

// 缓存最近一个 GOP，使切换脚本时无需重启编码器，也不会丢失首个操作。
export class ReplayVideoSegments {
  private writer: ReplayMp4Writer;
  private current: ReplayVideo;
  readonly segments: ReplayVideo[] = [];
  private config?: ScrcpyMediaStreamPacket;
  private gop: ScrcpyMediaStreamPacket[] = [];
  private bytes = 0;
  private origin?: bigint;
  private epoch = 0;
  private keyTime = 0;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(filePath: string, fileName: string) {
    this.current = { filePath, fileName, startedAt: '' };
    this.writer = new ReplayMp4Writer(filePath);
  }
  get startedAt() { return this.writer.startedAt; }
  private serialize<T>(task: () => Promise<T>) {
    const result = this.queue.then(task);
    this.queue = result.catch(() => undefined);
    return result;
  }
  start() { return this.writer.start(); }
  add(packet: ScrcpyMediaStreamPacket) {
    return this.serialize(async () => {
      await this.writer.add(packet);
      if (packet.type === 'configuration') { this.config = packet; return; }
      if (packet.keyframe && packet.pts !== undefined) {
        if (this.origin === undefined) { this.origin = packet.pts; this.epoch = this.writer.startedAt; }
        this.keyTime = this.epoch + Number(packet.pts - this.origin) / 1000;
        this.gop = []; this.bytes = 0;
      }
      if (this.keyTime) {
        this.bytes += packet.data.byteLength;
        // 编码器长期不发关键帧时停止缓存，避免无限占用内存。
        if (this.bytes > 32 * 1024 * 1024) { this.gop = []; this.keyTime = 0; }
        else this.gop.push(packet);
      }
    });
  }
  selectScript(scriptId: string, scriptName: string, force = false) {
    return this.serialize(async () => {
      if (!force && this.current.scriptId === scriptId) return;
      const boundary = new Date().toISOString();
      if (this.current.scriptId !== undefined) {
        if (!this.config || !this.gop.length) throw new Error('录屏分段缺少完整关键帧，请重新运行');
        await this.finishCurrent();
        const fileName = `replay-${Date.now()}-${randomUUID()}.mp4`;
        this.current = { filePath: join(dirname(this.current.filePath), fileName), fileName, startedAt: '' };
        this.writer = new ReplayMp4Writer(this.current.filePath, this.keyTime);
        await this.writer.start();
        await this.writer.add(this.config);
        for (const packet of this.gop) await this.writer.add(packet);
      }
      Object.assign(this.current, { scriptId, scriptName, boundaryAt: boundary });
    });
  }
  end() { this.writer.end(); }
  private async finishCurrent() {
    this.writer.end();
    await this.writer.finish();
    this.current.startedAt = new Date(this.writer.startedAt).toISOString();
    this.segments.push(this.current);
  }
  finish() { return this.serialize(() => this.finishCurrent()); }
  async cancel() {
    await this.writer.cancel().catch(() => undefined);
    await rm(this.current.filePath, { force: true });
  }
}
