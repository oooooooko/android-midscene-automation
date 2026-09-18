import { EncodedPacket, EncodedVideoPacketSource, FilePathTarget, Mp4OutputFormat, Output } from 'mediabunny';
import { h264ParseConfiguration, type ScrcpyMediaStreamPacket } from '@yume-chan/scrcpy';

// 仅封装 H.264，不解码或重新编码；最多保留最后一帧以计算静止画面的持续时间。
export class ReplayMp4Writer {
  private source = new EncodedVideoPacketSource('avc');
  private output: Output;
  private config?: ReturnType<typeof h264ParseConfiguration>;
  private configBytes?: Uint8Array;
  private origin?: bigint;
  private pending?: { data: Uint8Array; key: boolean; timestamp: number };
  private first = true;
  startedAt = 0;
  private startedMonotonic = 0;
  private endedMonotonic?: number;

  constructor(path: string) {
    this.output = new Output({ target: new FilePathTarget(path, { chunkSize: 1024 * 1024 }), format: new Mp4OutputFormat({ fastStart: 'fragmented' }) });
    this.output.addVideoTrack(this.source);
  }

  async start() { await this.output.start(); }

  async add(packet: ScrcpyMediaStreamPacket) {
    if (packet.type === 'configuration') {
      const config = h264ParseConfiguration(packet.data);
      if (this.configBytes && !Buffer.from(this.configBytes).equals(Buffer.from(packet.data))) {
        throw new Error('录屏编码配置发生变化，已保留变化前的视频');
      }
      this.config = config;
      this.configBytes = packet.data.slice();
      return;
    }
    if (!this.config || !this.configBytes) throw new Error('录屏缺少 H.264 配置信息');
    if (packet.pts === undefined) throw new Error('录屏视频包缺少时间戳');
    if (typeof packet.keyframe !== 'boolean') throw new Error('录屏视频包缺少关键帧标记');
    if (this.origin === undefined) {
      if (!packet.keyframe) return;
      this.origin = packet.pts;
      this.startedAt = Date.now();
      this.startedMonotonic = performance.now();
    }
    const timestamp = Number(packet.pts - this.origin) / 1000000;
    if (!Number.isFinite(timestamp) || timestamp < 0 || (this.pending && timestamp < this.pending.timestamp)) throw new Error('录屏时间戳异常');
    if (this.pending) await this.flush(Math.max(0.000001, timestamp - this.pending.timestamp));
    const data = this.first ? Buffer.concat([this.configBytes, packet.data]) : packet.data.slice();
    this.pending = { data, key: packet.keyframe, timestamp };
  }

  private async flush(duration: number) {
    if (!this.pending || !this.config) return;
    const { data, key, timestamp } = this.pending;
    const c = this.config;
    const codec = `avc1.${[c.profileIndex, c.constraintSet, c.levelIndex].map(v => v.toString(16).padStart(2, '0')).join('')}`;
    await this.source.add(new EncodedPacket(data, key ? 'key' : 'delta', timestamp, duration), this.first ? {
      decoderConfig: { codec, codedWidth: c.croppedWidth, codedHeight: c.croppedHeight },
    } : undefined);
    this.first = false;
    this.pending = undefined;
  }

  end() { this.endedMonotonic ??= performance.now(); }

  async finish() {
    if (!this.startedAt) throw new Error('未收到可录制的关键帧');
    await this.flush(Math.max(1 / 15, ((this.endedMonotonic ?? performance.now()) - this.startedMonotonic) / 1000 - (this.pending?.timestamp || 0)));
    this.source.close();
    await this.output.finalize();
  }

  async cancel() { await this.output.cancel(); }
}
