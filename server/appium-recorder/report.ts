import { mkdir, writeFile } from 'node:fs/promises';
import { stripReplayLogTime } from './replay-log';
import { join, relative } from 'node:path';
import type { ReplayVideo } from './replay-video';
import { PNG } from 'pngjs';
import { appDataPath } from '../paths';
import { loadConfig } from '../config';
import { saveAppiumReplayReport, type AppiumRecordedScriptRecord, type AppiumRecordedStepRecord } from './repository';
import { flowBranchLabel } from '../../src/appium-recorder/flow-labels';
import type { ImageCheckResult } from '../../src/appium-recorder/image-check';

type ReportImageCheck = ImageCheckResult & { nodeId: string; nodeNumber: number; nodeLabel: string; scriptName: string; settings: string };

export type AppiumReplayFrame = {
  sequence: number;
  scriptName: string;
  nodeId: string;
  nodeNumber: number;
  nodeLabel: string;
  nodeType: string;
  logContent?: string;
  note: string;
  selector: string;
  phase: 'before' | 'after' | 'error' | 'stopped' | 'observation';
  status: string;
  capturedAt: string;
  imageBase64: string;
};

export type AppiumReplayVisualCheck = {
  nodeId: string;
  nodeNumber: number;
  nodeLabel: string;
  startNodeId?: string;
  startNodeLabel?: string;
  endNodeId?: string;
  endNodeLabel?: string;
  status: 'passed' | 'failed';
  message: string;
  region: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  durationMs: number;
  intervalMs: number;
  sampleCount: number;
  changeRatioThreshold: number;
  maxChangeRatio: number;
  baselineBase64: string;
  comparisonBase64: string;
  diffBase64: string;
};

const HTML_REPORT_IMAGE_MAX_WIDTH = 540;
const HTML_REPORT_IMAGE_MAX_HEIGHT = 1200;

function pad(value: number, length = 2) {
  return String(value).padStart(length, '0');
}

function fileDateTime(date: Date) {
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join('-') + `_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}-${pad(date.getMilliseconds(), 3)}`;
}

function displayDateTime(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function safeFileName(value: string) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim() || '未命名脚本';
}

function htmlEscape(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function jsonForHtml(value: unknown) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function compressHtmlPngBase64(base64: string) {
  if (!base64) return base64;

  try {
    const source = PNG.sync.read(Buffer.from(base64, 'base64'));
    const scale = Math.min(
      1,
      HTML_REPORT_IMAGE_MAX_WIDTH / source.width,
      HTML_REPORT_IMAGE_MAX_HEIGHT / source.height,
    );

    if (scale >= 1) return base64;

    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const target = new PNG({ width, height });
    const scaleX = source.width / width;
    const scaleY = source.height / height;

    // HTML 回放只用于预览，降采样能明显降低报告体积，不影响实际检测结果。
    for (let y = 0; y < height; y += 1) {
      const sourceY = Math.min(source.height - 1, Math.floor(y * scaleY));
      for (let x = 0; x < width; x += 1) {
        const sourceX = Math.min(source.width - 1, Math.floor(x * scaleX));
        const sourceIndex = (sourceY * source.width + sourceX) << 2;
        const targetIndex = (y * width + x) << 2;
        target.data[targetIndex] = source.data[sourceIndex];
        target.data[targetIndex + 1] = source.data[sourceIndex + 1];
        target.data[targetIndex + 2] = source.data[sourceIndex + 2];
        target.data[targetIndex + 3] = source.data[sourceIndex + 3];
      }
    }

    return PNG.sync.write(target).toString('base64');
  } catch {
    return base64;
  }
}

export function htmlImageUrl(base64: string, cache: Map<string, string>) {
  const cached = cache.get(base64);
  if (cached) return cached;

  const imageUrl = `data:image/png;base64,${compressHtmlPngBase64(base64)}`;
  cache.set(base64, imageUrl);
  return imageUrl;
}

function markdownValue(value: unknown) {
  if (value === undefined || value === null || value === '') return '-';
  return String(value).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

function selectorText(selector?: AppiumRecordedStepRecord['selector']) {
  if (!selector) return '-';
  if (selector.strategy === 'bounds') return `bounds (${selector.centerX ?? '-'}, ${selector.centerY ?? '-'})`;
  return `${selector.strategy} ${selector.value || ''}`.trim();
}

function stepExecutionLines(outputLines: string[], index: number) {
  const prefixes = [`[节点 ${index + 1}]`, `[步骤 ${index + 1}]`];
  return outputLines.filter((line) => prefixes.some((prefix) => stripReplayLogTime(line).startsWith(prefix)));
}

function executionStatus(lines: string[]) {
  if (!lines.length) return '未执行';
  // 只识别执行器的状态前缀，用户日志中的“失败”等文字不是执行结果。
  const messages = lines.map((line) => stripReplayLogTime(line).replace(/^\[(?:节点|步骤) \d+\] /, ''));
  if (messages.some((line) => line.startsWith('失败：') || line.startsWith('失败分支：'))) return '失败';
  if (messages.some((line) => line.startsWith('跳过：'))) return '跳过';
  if (messages.some((line) => line.startsWith('判断：'))) return '判断完成';
  if (messages.some((line) => line.startsWith('完成：'))) return '成功';
  return '中断';
}

function visualCheckStatusLabel(status: AppiumReplayVisualCheck['status']) {
  return status === 'passed' ? '有变化' : '无明显变化';
}

function visualCheckSection(check?: AppiumReplayVisualCheck) {
  if (!check) return '';
  const statusLabel = visualCheckStatusLabel(check.status);
  const region = `${check.region.x}, ${check.region.y}, ${check.region.width} x ${check.region.height}`;
  return [
    '#### 画面变化检测',
    '',
    '| 项目 | 内容 |',
    '| --- | --- |',
    `| 检测结果 | **${statusLabel}** |`,
    `| 开始节点 | ${markdownValue(check.startNodeLabel || check.startNodeId)} |`,
    `| 结束节点 | ${markdownValue(check.endNodeLabel || check.endNodeId)} |`,
    `| 检测区域 | ${markdownValue(region)} |`,
    `| 对比方式 | ${check.durationMs ? markdownValue(`${check.durationMs}ms / 每 ${check.intervalMs}ms`) : '起止节点截图对比'} |`,
    `| 采样次数 | ${check.sampleCount} |`,
    `| 变化阈值 | ${check.changeRatioThreshold}% |`,
    `| 最大变化比例 | ${check.maxChangeRatio.toFixed(2)}% |`,
    `| 说明 | ${markdownValue(check.message)} |`,
    '',
    '| 基准帧 | 对比帧 | 差异图 |',
    '| --- | --- | --- |',
    `| ![基准帧](data:image/png;base64,${check.baselineBase64}) | ![对比帧](data:image/png;base64,${check.comparisonBase64}) | ![差异图](data:image/png;base64,${check.diffBase64}) |`,
    '',
  ].join('\n');
}

function stepSection(
  step: AppiumRecordedStepRecord,
  index: number,
  outputLines: string[],
  visualCheck?: AppiumReplayVisualCheck,
) {
  const executionLines = stepExecutionLines(outputLines, index);
  const config = JSON.stringify(step, null, 2);
  return [
    `### ${index + 1}. ${step.label}`,
    '',
    '| 配置项 | 值 |',
    '| --- | --- |',
    `| 节点 ID | ${markdownValue(step.id)} |`,
    `| 操作类型 | ${markdownValue(step.type)} |`,
    `| 节点类型 | ${markdownValue(step.flow?.nodeKind || 'action')} |`,
    `| 备注 | ${markdownValue(step.note)} |`,
    `| Selector | ${markdownValue(selectorText(step.selector))} |`,
    `| 上下文 Selector | ${markdownValue(selectorText(step.contextSelector))} |`,
    `| 输入/目标值 | ${markdownValue(step.value)} |`,
    `| 超时时间 | ${markdownValue(step.timeoutMs === undefined ? '-' : `${step.timeoutMs}ms`)} |`,
    `| ${flowBranchLabel(step, 'yes')} 分支 | ${markdownValue(step.flow?.yesTargetId)} |`,
    `| ${flowBranchLabel(step, 'no')} 分支 | ${markdownValue(step.flow?.noTargetId)} |`,
    `| 成功后续节点 | ${markdownValue(step.flow?.successTargetId)} |`,
    `| 执行状态 | **${executionStatus(executionLines)}** |`,
    '',
    '#### 执行信息',
    '',
    executionLines.length ? '```text' : '',
    executionLines.length ? executionLines.join('\n') : '该节点未进入执行路径，或在前序失败后未执行。',
    executionLines.length ? '```' : '',
    '',
    visualCheckSection(visualCheck),
    '<details>',
    '<summary>完整节点配置</summary>',
    '',
    '```json',
    config,
    '```',
    '</details>',
    '',
  ].filter((line, lineIndex, lines) => line !== '' || lines[lineIndex - 1] !== '').join('\n');
}

function createReplayHtml(input: {
  video?: { url: string; startedAt: string; segments?: Array<{ url: string; startedAt: string; boundaryAt?: string; scriptName?: string }> };
  script: AppiumRecordedScriptRecord;
  deviceId: string;
  resultText: string;
  durationMs: number;
  startedAt: Date;
  completedAt: Date;
  frames: AppiumReplayFrame[];
  visualChecks: AppiumReplayVisualCheck[];
  imageChecks?: ReportImageCheck[];
  output: string;
}) {
  const imageCache = new Map<string, string>();
  const payload = jsonForHtml({
    video: input.video,
    startedAt: input.startedAt.toISOString(),
    durationMs: input.durationMs,
    frames: input.frames.map((frame) => ({
      ...frame,
      imageUrl: htmlImageUrl(frame.imageBase64, imageCache),
      imageBase64: undefined,
    })),
    visualChecks: input.visualChecks.map((check) => ({
      ...check,
      baselineImageUrl: htmlImageUrl(check.baselineBase64, imageCache),
      comparisonImageUrl: htmlImageUrl(check.comparisonBase64, imageCache),
      diffImageUrl: htmlImageUrl(check.diffBase64, imageCache),
      baselineBase64: undefined,
      comparisonBase64: undefined,
      diffBase64: undefined,
    })),
    output: input.output,
    imageChecks: (input.imageChecks || []).map(check => ({ ...check,
      images: check.images.map(image => ({ label: image.label, url: htmlImageUrl(image.base64, imageCache) })),
    })),
  });
  const resultClass = input.resultText === '成功' ? 'success' : input.resultText === '已终止' ? 'stopped' : 'failed';
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${htmlEscape(input.script.name)} - Appium 截图回放</title>
  <style>
    * { box-sizing: border-box; }
    :root { color: #1f2329; background: #f4f6f8; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif; }
    body { margin: 0; overflow: hidden; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 24px; min-height: 72px; padding: 16px 24px; border-bottom: 1px solid #dfe3e8; background: #fff; }
    h1 { margin: 0; font-size: 20px; letter-spacing: 0; }
    .meta { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px 16px; color: #646a73; font-size: 13px; }
    .meta-item { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; white-space: nowrap; }
    .meta-label { color: #8a9099; }
    .meta-value { color: #4b515a; font-variant-numeric: tabular-nums; }
    .status { display: inline-flex; align-items: center; min-height: 32px; padding: 0 12px; border-radius: 4px; font-weight: 600; }
    .status.success { color: #237804; background: #f0f9eb; }
    .status.failed { color: #cf1322; background: #fff1f0; }
    .status.stopped { color: #ad6800; background: #fff7e6; }
    main { display: grid; grid-template-columns: 340px minmax(0, 1fr); height: calc(100vh - 72px); }
    aside { min-width: 0; overflow-y: auto; border-right: 1px solid #dfe3e8; background: #fff; }
    .detail { padding: 18px; border-bottom: 1px solid #e5e8ec; }
    .detail h2 { margin: 0 0 14px; font-size: 16px; overflow-wrap: anywhere; }
    .detail dl { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 7px 10px; margin: 0; font-size: 12px; }
    .detail dt { color: #8a9099; }
    .detail dd { margin: 0; overflow-wrap: anywhere; }
    .step-list { padding: 10px; }
    .frame-item { display: grid; width: 100%; grid-template-columns: 28px minmax(0, 1fr) auto; gap: 9px; align-items: center; margin-bottom: 6px; padding: 9px; text-align: left; }
    .frame-item.active { border-color: #1677ff; background: #edf6ff; color: #1f2329; }
    .frame-index { display: grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: #eef1f5; font-size: 11px; }
    .frame-title, .frame-subtitle { display: block; overflow-wrap: anywhere; }
    .frame-title { font-size: 13px; font-weight: 600; }
    .frame-subtitle, .frame-time { margin-top: 3px; color: #7a818b; font-size: 11px; }
    .frame-log, #node-log { white-space: pre-wrap; overflow-wrap: anywhere; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
    .frame-log { display: block; margin-top: 6px; color: #4b515a; font-size: 12px; line-height: 1.5; }
    .workspace { display: grid; grid-template-rows: 178px minmax(0, 1fr); min-width: 0; min-height: 0; }
    .timeline-panel { min-width: 0; overflow-x: auto; overflow-y: hidden; border-bottom: 1px solid #dfe3e8; background: #fff; }
    .timeline-track { position: relative; height: 178px; min-width: 100%; cursor: pointer; user-select: none; }
    .ruler { position: absolute; inset: 0 0 auto; height: 34px; border-bottom: 1px solid #e5e8ec; }
    .tick { position: absolute; top: 0; bottom: 0; width: 1px; background: #e5e8ec; }
    .tick-label { position: absolute; top: 8px; left: 6px; color: #646a73; font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .thumbnail { position: absolute; top: 48px; width: 58px; height: 106px; padding: 0; overflow: hidden; border: 2px solid #cfd5dd; border-radius: 3px; background: #101827; transform: translateX(-50%); }
    .thumbnail img { display: block; width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
    .thumbnail.active { z-index: 2; border-color: #1677ff; box-shadow: 0 0 0 2px rgba(22, 119, 255, .18); }
    .playhead { position: absolute; z-index: 3; top: 0; bottom: 0; width: 2px; background: #1677ff; pointer-events: none; }
    .playhead::before { position: absolute; top: 29px; left: 50%; width: 10px; height: 10px; border-radius: 50%; background: #1677ff; content: ''; transform: translate(-50%, -50%); }
    .viewer { display: grid; grid-template-rows: minmax(0, 1fr) auto auto; min-width: 0; min-height: 0; padding: 16px 20px 12px; background: #f4f6f8; }
    .screen { display: flex; align-items: center; justify-content: center; min-height: 0; overflow: hidden; border-radius: 6px; background: #101827; }
    .screen img { display: block; width: 100%; height: 100%; object-fit: contain; transition: opacity .12s ease; }
    [hidden] { display: none !important; }
    .empty { color: #a8abb2; }
    .caption { min-height: 40px; padding: 10px 4px 0; overflow: hidden; color: #4b515a; font-size: 13px; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
    .controls { display: grid; grid-template-columns: auto auto auto minmax(120px, 1fr) auto; align-items: center; gap: 8px; min-height: 52px; }
    .controls:has(#toggle-recording:not([hidden])) { grid-template-columns: auto auto auto auto minmax(80px, 1fr) auto; }
    button { min-height: 34px; padding: 0 14px; border: 1px solid #cfd5dd; border-radius: 4px; color: #30343b; background: #fff; cursor: pointer; }
    button:hover:not(:disabled) { border-color: #409eff; color: #1677ff; }
    button:disabled { cursor: not-allowed; opacity: .45; }
    #seek { width: 100%; accent-color: #1677ff; cursor: pointer; }
    #clock { min-width: 92px; color: #646a73; font-size: 12px; text-align: right; font-variant-numeric: tabular-nums; }
    details { margin: 4px 10px 16px; border: 1px solid #dfe3e8; border-radius: 6px; background: #fff; }
    summary { padding: 12px 14px; cursor: pointer; font-weight: 600; }
    pre { max-height: 360px; margin: 0; overflow: auto; padding: 14px; border-top: 1px solid #e5e8ec; white-space: pre; font: 11px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace; }
    .visual-check-list { display: grid; gap: 12px; padding: 0 12px 12px; border-top: 1px solid #e5e8ec; }
    .visual-check { padding: 12px 0 0; border-top: 1px solid #eef1f5; }
    .visual-check:first-child { border-top: 0; }
    .visual-check h3 { margin: 0 0 8px; font-size: 13px; overflow-wrap: anywhere; }
    .visual-check dl { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 5px 8px; margin: 0 0 10px; font-size: 12px; }
    .visual-check dt { color: #8a9099; }
    .visual-check dd { margin: 0; overflow-wrap: anywhere; }
    .visual-check .passed { color: #237804; font-weight: 700; }
    .visual-check .failed { color: #cf1322; font-weight: 700; }
    .visual-images { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
    .visual-image span { display: block; margin-bottom: 4px; color: #646a73; font-size: 11px; text-align: center; }
    .visual-image img { display: block; width: 100%; max-height: 120px; object-fit: contain; border: 1px solid #dfe3e8; border-radius: 3px; background: #101827; cursor: zoom-in; }
    .visual-image img:hover { border-color: #1677ff; }
    .image-preview { position: fixed; inset: 0; z-index: 20; display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 12px; padding: 20px; background: rgba(16, 24, 39, .88); }
    .image-preview[hidden] { display: none; }
    .image-preview__bar { display: flex; align-items: center; justify-content: space-between; gap: 16px; color: #fff; }
    .image-preview__title { min-width: 0; overflow: hidden; font-size: 14px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
    .image-preview__close { flex: 0 0 auto; border-color: rgba(255, 255, 255, .28); color: #fff; background: rgba(255, 255, 255, .1); }
    .image-preview__image { place-self: center; max-width: 100%; max-height: calc(100vh - 88px); object-fit: contain; border-radius: 4px; background: #101827; box-shadow: 0 20px 60px rgba(0, 0, 0, .35); }
    @media (max-width: 860px) {
      body { overflow: auto; }
      main { grid-template-columns: 1fr; height: auto; }
      aside { max-height: 520px; border-right: 0; border-bottom: 1px solid #dfe3e8; }
      .workspace { grid-template-rows: 150px minmax(520px, 70vh); }
      .timeline-track { height: 150px; }
      .thumbnail { height: 78px; }
      header { align-items: flex-start; flex-direction: column; }
      .meta { justify-content: flex-start; }
      .controls, .controls:has(#toggle-recording:not([hidden])) { display: flex; flex-wrap: wrap; }
      .controls button { max-width: 100%; }
      #seek { flex: 1 1 120px; width: auto; }
    }
  </style>
</head>
<body>
  <header>
    <h1>${htmlEscape(input.script.name)}</h1>
    <div class="meta">
      <span class="status ${resultClass}">${htmlEscape(input.resultText)}</span>
      <span class="meta-item"><span class="meta-label">设备</span><span class="meta-value">${htmlEscape(input.deviceId)}</span></span>
      <span class="meta-item"><span class="meta-label">App</span><span class="meta-value">${htmlEscape(input.script.appPackage)}</span></span>
      <span class="meta-item"><span class="meta-label">耗时</span><span class="meta-value">${input.durationMs}ms</span></span>
      <span class="meta-item"><span class="meta-label">时间</span><span class="meta-value">${htmlEscape(displayDateTime(input.startedAt))} - ${htmlEscape(displayDateTime(input.completedAt))}</span></span>
    </div>
  </header>
  <main>
    <aside>
      <section class="detail">
        <h2 id="title">暂无截图</h2>
        <dl>
          <dt>脚本</dt><dd id="script">-</dd>
          <dt>节点</dt><dd id="node">-</dd>
          <dt>阶段</dt><dd id="phase">-</dd>
          <dt>结果</dt><dd id="frame-status">-</dd>
          <dt id="node-log-label" hidden>日志内容</dt><dd id="node-log" hidden></dd>
          <dt>备注</dt><dd id="note">-</dd>
          <dt>定位</dt><dd id="selector">-</dd>
          <dt>时间</dt><dd id="time">-</dd>
        </dl>
      </section>
      <nav id="step-list" class="step-list" aria-label="执行步骤"></nav>
      <details open><summary>图像判断</summary><div id="image-checks" class="visual-check-list"></div></details>
      <details><summary>视觉变化检测</summary><div id="visual-checks" class="visual-check-list"></div></details>
      <details><summary>完整回放日志</summary><pre id="log"></pre></details>
    </aside>
    <section class="workspace">
      <div class="timeline-panel">
        <div id="timeline-track" class="timeline-track" aria-label="回放时间轴">
          <div id="ruler" class="ruler"></div>
          <div id="playhead" class="playhead"></div>
        </div>
      </div>
      <section class="viewer">
        <div class="screen"><video id="recording" controls preload="metadata" playsinline hidden style="width:100%;height:100%;object-fit:contain"></video><img id="screen" alt="设备截图" hidden /><span id="empty" class="empty">本次回放没有可用截图</span></div>
        <div id="caption" class="caption">暂无截图</div>
        <div class="controls">
          <button id="toggle-recording" hidden>查看节点截图</button>
          <select id="video-segment" aria-label="视频片段" hidden style="max-width:100%;min-width:0"></select>
          <button id="previous" type="button" title="上一帧">上一帧</button>
          <button id="play" type="button">播放</button>
          <button id="next" type="button" title="下一帧">下一帧</button>
          <input id="seek" type="range" min="0" max="1000" value="0" aria-label="回放进度" />
          <span id="clock">00:00 / 00:00</span>
        </div>
      </section>
    </section>
  </main>
  <div id="image-preview" class="image-preview" hidden>
    <div class="image-preview__bar">
      <span id="image-preview-title" class="image-preview__title"></span>
      <button id="image-preview-close" class="image-preview__close" type="button">关闭</button>
    </div>
    <img id="image-preview-image" class="image-preview__image" alt="" />
  </div>
  <script id="replay-data" type="application/json">${payload}</script>
  <script>
    const data = JSON.parse(document.querySelector('#replay-data').textContent || '{}');
    const visualChecks = Array.isArray(data.visualChecks) ? data.visualChecks : [];
    const reportStartedAt = Date.parse(data.startedAt) || 0;
    const recording = document.querySelector('#recording');
    const toggleRecording = document.querySelector('#toggle-recording');
    const videos = data.video ? (data.video.segments || [data.video]) : [];
    const segmentSelect = document.querySelector('#video-segment');
    let activeVideo = 0;
    let videoOffset = Math.max(0, (Date.parse(videos[0]?.startedAt) || reportStartedAt) - reportStartedAt);
    videos.forEach((video, index) => {
      const option = document.createElement('option');
      option.value = String(index); option.textContent = (index + 1) + '. ' + (video.scriptName || data.scriptName || '回放视频');
      segmentSelect.appendChild(option);
    });
    segmentSelect.hidden = videos.length < 2;
    let videoMode = Boolean(data.video);
    let pendingVideoTime = 0;
    if (data.video) { recording.src = data.video.url; toggleRecording.hidden = false; }
    const frames = (Array.isArray(data.frames) ? data.frames : []).map((frame) => ({
      ...frame,
      offsetMs: Math.max(0, (Date.parse(frame.capturedAt) || reportStartedAt) - reportStartedAt),
    }));
    const durationMs = Math.max(1000, Number(data.durationMs) || 0, frames.at(-1)?.offsetMs || 0);
    // 按一次执行配对，而不是按节点 ID 全局去重；连接脚本和重复执行仍保留独立步骤。
    const steps = [];
    const frameSteps = [];
    const pendingSteps = new Map();
    frames.forEach((frame, index) => {
      const key = JSON.stringify([frame.scriptName, frame.nodeId, frame.nodeNumber]);
      const pending = pendingSteps.get(key) || [];
      let stepIndex = frame.phase === 'before' ? undefined : frame.phase === 'observation' ? pending.at(-1) : pending.pop();
      if (stepIndex === undefined) {
        stepIndex = steps.length;
        steps.push({ firstIndex: index, lastIndex: index });
      } else {
        steps[stepIndex].lastIndex = index;
      }
      if (frame.phase === 'before') pending.push(stepIndex);
      pendingSteps.set(key, pending);
      frameSteps[index] = stepIndex;
    });
    const elements = Object.fromEntries(['screen','empty','previous','play','next','seek','clock','caption','title','script','node','phase','frame-status','note','selector','time','step-list','timeline-track','ruler','playhead','visual-checks','log'].map((id) => [id, document.querySelector('#' + id)]));
    const imagePreview = document.querySelector('#image-preview');
    const imagePreviewImage = document.querySelector('#image-preview-image');
    const imagePreviewTitle = document.querySelector('#image-preview-title');
    const closeImagePreview = () => {
      imagePreview.hidden = true;
      imagePreviewImage.removeAttribute('src');
    };
    const openImagePreview = (url, title) => {
      imagePreviewImage.src = url;
      imagePreviewImage.alt = title;
      imagePreviewTitle.textContent = title;
      imagePreview.hidden = false;
    };
    let currentFrame = frames.length ? 0 : -1;
    let currentMs = 0;
    let animationFrame = 0;
    let playbackStartedAt = 0;
    const phaseLabels = { before: '执行前', after: '执行后', observation: '观察采样', error: '失败', stopped: '已终止' };
    const visualCheckStatusLabel = (status) => status === 'passed' ? '有变化' : '无明显变化';
    const formatTime = (milliseconds) => {
      const seconds = Math.max(0, Math.floor(milliseconds / 1000));
      return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
    };
    const frameAt = (milliseconds) => {
      let index = frames.length ? 0 : -1;
      for (let candidate = 0; candidate < frames.length && frames[candidate].offsetMs <= milliseconds; candidate += 1) index = candidate;
      return index;
    };
    const render = (scrollStep = false) => {
      const nextFrame = frameAt(currentMs);
      const frameChanged = nextFrame !== currentFrame;
      currentFrame = nextFrame;
      const frame = frames[currentFrame];
      elements.empty.hidden = videoMode || Boolean(frame?.imageUrl);
      elements.screen.hidden = videoMode || !frame?.imageUrl;
      recording.hidden = !videoMode;
      if (frame) {
        if (frameChanged || elements.screen.src !== frame.imageUrl) elements.screen.src = frame.imageUrl;
        elements.title.textContent = frame.nodeLabel || '未命名节点';
        elements.script.textContent = frame.scriptName || '-';
        elements.node.textContent = String(frame.nodeNumber || '-');
        elements.phase.textContent = phaseLabels[frame.phase] || frame.phase || '-';
        elements['frame-status'].textContent = frame.status || '-';
        const logContent = frames[steps[frameSteps[currentFrame]].lastIndex].logContent;
        document.querySelector('#node-log-label').hidden = !logContent;
        document.querySelector('#node-log').hidden = !logContent;
        document.querySelector('#node-log').textContent = logContent || '';
        elements.note.textContent = frame.note || '-';
        elements.selector.textContent = frame.selector || '-';
        elements.time.textContent = new Date(frame.capturedAt).toLocaleString();
        elements.caption.textContent = frame.nodeNumber + '. ' + frame.nodeLabel + ' · ' + (phaseLabels[frame.phase] || frame.phase) + ' · ' + frame.status;
      }
      elements.previous.disabled = !frames.length || currentFrame <= 0;
      elements.next.disabled = !frames.length || currentFrame >= frames.length - 1;
      elements.play.disabled = !videoMode && frames.length < 2;
      elements.seek.value = String(Math.round(currentMs / durationMs * 1000));
      elements.clock.textContent = formatTime(currentMs) + ' / ' + formatTime(durationMs);
      elements.playhead.style.left = (currentMs / durationMs * 100) + '%';
      document.querySelectorAll('.frame-item').forEach((item) => item.classList.toggle('active', Number(item.dataset.step) === frameSteps[currentFrame]));
      document.querySelectorAll('.thumbnail').forEach((item) => item.classList.toggle('active', Number(item.dataset.index) === currentFrame));
      if (scrollStep) document.querySelector('.frame-item.active')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    };
    const pause = () => {
      recording.pause();
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      elements.play.textContent = '播放';
    };
    const seekTo = (milliseconds, scrollStep = true) => {
      currentMs = Math.max(0, Math.min(durationMs, milliseconds));
      let index = 0;
      for (let i = 1; i < videos.length; i++) {
        if (Date.parse(videos[i].boundaryAt || videos[i].startedAt) - reportStartedAt <= currentMs) index = i;
      }
      if (index !== activeVideo) {
        activeVideo = index; segmentSelect.value = String(index);
        videoOffset = Math.max(0, Date.parse(videos[index].startedAt) - reportStartedAt);
        recording.src = videos[index].url;
      }
      pendingVideoTime = Math.max(0, (currentMs - videoOffset) / 1000);
      if (data.video && recording.readyState >= 1) recording.currentTime = Math.min(pendingVideoTime, recording.duration || pendingVideoTime);
      render(scrollStep);
    };
    recording.addEventListener('loadedmetadata', () => { recording.currentTime = Math.min(pendingVideoTime, recording.duration); });
    segmentSelect.addEventListener('change', () => {
      pause();
      const video = videos[Number(segmentSelect.value)];
      seekTo(Date.parse(video.boundaryAt || video.startedAt) - reportStartedAt);
    });
    recording.addEventListener('ended', () => {
      if (videoMode && activeVideo + 1 < videos.length) {
        const next = videos[activeVideo + 1];
        seekTo(Date.parse(next.boundaryAt || next.startedAt) - reportStartedAt);
        recording.play().catch(() => undefined);
      }
    });
    recording.addEventListener('timeupdate', () => {
      if (!videoMode || recording.paused) return;
      currentMs = recording.currentTime * 1000 + videoOffset;
      render();
    });
    recording.addEventListener('seeked', () => {
      if (!videoMode) return;
      currentMs = recording.currentTime * 1000 + videoOffset;
      render();
    });
    recording.addEventListener('play', () => { elements.play.textContent = '暂停'; });
    recording.addEventListener('pause', () => { elements.play.textContent = '播放'; });
    recording.addEventListener('error', () => {
      pause(); videoMode = false; render();
      toggleRecording.textContent = '视频不可用，请将 MP4 与报告放在一起';
      toggleRecording.disabled = true;
    });
    toggleRecording.addEventListener('click', () => {
      pause(); videoMode = !videoMode;
      toggleRecording.textContent = videoMode ? '查看节点截图' : '查看回放视频';
      seekTo(currentMs, false);
    });
    const tickPlayback = (now) => {
      currentMs = Math.min(durationMs, now - playbackStartedAt);
      render();
      if (currentMs >= durationMs) return pause();
      animationFrame = requestAnimationFrame(tickPlayback);
    };
    const trackWidth = Math.max(900, Math.ceil(durationMs / 1000) * 56);
    elements['timeline-track'].style.width = trackWidth + 'px';
    const tickChoices = [1000, 2000, 5000, 10000, 20000, 30000, 60000, 120000, 300000];
    const tickMs = tickChoices.find((choice) => durationMs / choice <= 12) || tickChoices.at(-1);
    for (let milliseconds = 0; milliseconds <= durationMs; milliseconds += tickMs) {
      const tick = document.createElement('span');
      tick.className = 'tick';
      tick.style.left = (milliseconds / durationMs * 100) + '%';
      const label = document.createElement('span');
      label.className = 'tick-label';
      label.textContent = formatTime(milliseconds);
      tick.append(label);
      elements.ruler.append(tick);
    }
    steps.forEach((step, index) => {
      const frame = frames[step.firstIndex];
      const result = frames[step.lastIndex];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'frame-item';
      button.dataset.step = String(index);
      const badge = document.createElement('span');
      badge.className = 'frame-index';
      badge.textContent = String(index + 1);
      const content = document.createElement('span');
      const title = document.createElement('span');
      title.className = 'frame-title';
      title.textContent = frame.nodeNumber + '. ' + frame.nodeLabel;
      const subtitle = document.createElement('span');
      subtitle.className = 'frame-subtitle';
      subtitle.textContent = result.phase === 'before' ? '未完成' : result.status;
      content.append(title, subtitle);
      if (frame.nodeType === 'textClick') {
        const text = document.createElement('span');
        text.className = 'frame-log frame-click-text';
        text.textContent = frame.selector || '未设置点击文字';
        content.append(text);
      }
      if (result.logContent) {
        const log = document.createElement('span');
        log.className = 'frame-log';
        log.textContent = result.logContent;
        content.append(log);
      }
      const time = document.createElement('span');
      time.className = 'frame-time';
      time.textContent = formatTime(frame.offsetMs);
      button.append(badge, content, time);
      button.addEventListener('click', () => { pause(); seekTo(frame.offsetMs); });
      elements['step-list'].append(button);
    });
    frames.forEach((frame, index) => {
      const thumbnail = document.createElement('button');
      thumbnail.type = 'button';
      thumbnail.className = 'thumbnail';
      thumbnail.dataset.index = String(index);
      thumbnail.style.left = (30 + frame.offsetMs / durationMs * (trackWidth - 60)) + 'px';
      thumbnail.title = frame.nodeNumber + '. ' + frame.nodeLabel + ' · ' + formatTime(frame.offsetMs);
      const image = document.createElement('img');
      image.src = frame.imageUrl;
      image.alt = thumbnail.title;
      thumbnail.append(image);
      thumbnail.addEventListener('click', (event) => { event.stopPropagation(); pause(); seekTo(frame.offsetMs); });
      elements['timeline-track'].append(thumbnail);
    });
    const imageChecksElement = document.querySelector('#image-checks');
    if (!(data.imageChecks || []).length) imageChecksElement.parentElement.hidden = true;
    (data.imageChecks || []).forEach(check => {
      const article = document.createElement('article');
      article.className = 'visual-check';
      const title = document.createElement('h3');
      title.textContent = check.scriptName + ' · ' + check.nodeNumber + '. ' + check.nodeLabel;
      article.append(title);
      const detail = document.createElement('dl');
      const region = check.region || {};
      const match = check.templateMatch;
      const entries = [
        ...(match ? [['实际匹配结果', match.matched ? '匹配到模板' : '未匹配到模板'],
          ['预期匹配结果', match.expected === 'present' ? '匹配到模板' : '未匹配到模板'],
          ['匹配得分 / 严格度', (match.score * 100).toFixed(4) + '% / ' + (match.threshold * 100).toFixed(4) + '%']] : []),
        [match ? '条件是否成立' : '结果', check.timedOut ? '观察超时（按节点超时配置处理）' : check.result === null ? '无法判定' : match ? (check.result ? '成立 → true 分支' : '不成立 → false 分支') : String(check.result)], ['配置', check.settings],
        ['区域', [region.x, region.y, region.width, region.height].join(', ')],
        ['采样', check.sampleCount + ' 帧'], ['耗时', check.durationMs + 'ms'], ['说明', check.message], ...Object.entries(check.metrics)];
      entries.forEach(([key, value]) => {
        const dt = document.createElement('dt'), dd = document.createElement('dd');
        dt.textContent = key; dd.textContent = String(value); detail.append(dt, dd);
      });
      article.append(detail);
      const images = document.createElement('div'); images.className = 'visual-images';
      check.images.forEach(image => {
        if (!image.url) return;
        const figure = document.createElement('div'); figure.className = 'visual-image';
        const caption = document.createElement('span'); caption.textContent = image.label;
        const img = document.createElement('img'); img.src = image.url; img.alt = image.label; img.title = '点击放大'; img.tabIndex = 0;
        const open = () => openImagePreview(image.url, check.nodeLabel + ' · ' + image.label);
        img.addEventListener('click', open);
        img.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
        figure.append(caption, img); images.append(figure);
      });
      article.append(images); imageChecksElement.append(article);
    });
    if (!visualChecks.length) {
      elements['visual-checks'].textContent = '本次没有视觉变化检测节点';
    }
    visualChecks.forEach((check) => {
      const article = document.createElement('article');
      article.className = 'visual-check';
      const title = document.createElement('h3');
      title.textContent = check.nodeNumber + '. ' + check.nodeLabel;
      const detail = document.createElement('dl');
      [
        ['结果', visualCheckStatusLabel(check.status), check.status],
        ['开始节点', check.startNodeLabel || check.startNodeId || '-'],
        ['结束节点', check.endNodeLabel || check.endNodeId || '-'],
        ['区域', check.region.x + ', ' + check.region.y + ', ' + check.region.width + ' x ' + check.region.height],
        ['对比', check.durationMs ? check.sampleCount + ' 次 / 每 ' + check.intervalMs + 'ms' : '起止节点截图对比'],
        ['阈值', check.changeRatioThreshold + '%'],
        ['最大变化', Number(check.maxChangeRatio || 0).toFixed(2) + '%'],
        ['说明', check.message || '-'],
      ].forEach(([label, value, className]) => {
        const dt = document.createElement('dt');
        const dd = document.createElement('dd');
        dt.textContent = label;
        dd.textContent = value;
        if (className) dd.className = className;
        detail.append(dt, dd);
      });
      const images = document.createElement('div');
      images.className = 'visual-images';
      [
        ['基准帧', check.baselineImageUrl],
        ['对比帧', check.comparisonImageUrl],
        ['差异图', check.diffImageUrl],
      ].forEach(([label, url]) => {
        const figure = document.createElement('div');
        figure.className = 'visual-image';
        const caption = document.createElement('span');
        caption.textContent = label;
        const img = document.createElement('img');
        img.src = url;
        img.alt = label;
        img.title = '点击放大 ' + label;
        img.tabIndex = 0;
        img.addEventListener('click', () => openImagePreview(url, check.nodeNumber + '. ' + check.nodeLabel + ' · ' + label));
        img.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            openImagePreview(url, check.nodeNumber + '. ' + check.nodeLabel + ' · ' + label);
          }
        });
        figure.append(caption, img);
        images.append(figure);
      });
      article.append(title, detail, images);
      elements['visual-checks'].append(article);
    });
    elements.previous.addEventListener('click', () => { pause(); seekTo(frames[Math.max(0, currentFrame - 1)]?.offsetMs || 0); });
    elements.next.addEventListener('click', () => { pause(); seekTo(frames[Math.min(frames.length - 1, currentFrame + 1)]?.offsetMs || durationMs); });
    elements.play.addEventListener('click', () => {
      if (videoMode) {
        if (!recording.paused) return pause();
        recording.play().catch(() => { elements.caption.textContent = '视频无法播放，请检查 MP4 文件是否存在或使用其他浏览器'; });
        return;
      }
      if (animationFrame) return pause();
      if (currentMs >= durationMs) currentMs = 0;
      playbackStartedAt = performance.now() - currentMs;
      elements.play.textContent = '暂停';
      animationFrame = requestAnimationFrame(tickPlayback);
    });
    elements.seek.addEventListener('input', () => { pause(); seekTo(Number(elements.seek.value) / 1000 * durationMs, false); });
    elements['timeline-track'].addEventListener('click', (event) => {
      if (event.target.closest('.thumbnail')) return;
      const bounds = elements['timeline-track'].getBoundingClientRect();
      pause();
      seekTo((event.clientX - bounds.left) / bounds.width * durationMs);
    });
    document.addEventListener('keydown', (event) => {
      if (!imagePreview.hidden) {
        if (event.key === 'Escape') closeImagePreview();
        return;
      }
      if (event.key === 'ArrowLeft') elements.previous.click();
      if (event.key === 'ArrowRight') elements.next.click();
      if (event.key === ' ') { event.preventDefault(); elements.play.click(); }
    });
    imagePreview.addEventListener('click', (event) => {
      if (event.target === imagePreview) closeImagePreview();
    });
    document.querySelector('#image-preview-close').addEventListener('click', closeImagePreview);
    elements.log.textContent = data.output || '';
    seekTo(frames[0]?.offsetMs || 0, false);
  </script>
</body>
</html>`;
}

export async function createAppiumReplayReport(input: {
  screenshotReport?: boolean;
  video?: ReplayVideo;
  script: AppiumRecordedScriptRecord;
  deviceId: string;
  success: boolean;
  stopped?: boolean;
  output: string;
  startedAt: Date;
  completedAt: Date;
  frames?: AppiumReplayFrame[];
  visualChecks?: AppiumReplayVisualCheck[];
  imageChecks?: ReportImageCheck[];
}) {
  const configuredOutputPath = loadConfig().runtime.reportOutputPath.trim();
  const outputDir = appDataPath(configuredOutputPath || 'output');
  await mkdir(outputDir, { recursive: true });
  const baseName = `${fileDateTime(input.completedAt)}-${safeFileName(input.script.name)}`;
  const fileName = `${baseName}.md`;
  const logFileName = `${baseName}.log`;
  const htmlFileName = (input.screenshotReport ?? loadConfig().appium.screenshotReport) === true ? `${baseName}.html` : '';
  const filePath = join(outputDir, fileName);
  const logPath = join(outputDir, logFileName);
  const htmlReportPath = htmlFileName ? join(outputDir, htmlFileName) : '';
  const persistedOutput = [
    input.output,
    `回放报告：${filePath}`,
    htmlReportPath ? `截图回放：${htmlReportPath}` : '',
    `回放日志：${logPath}`,
  ].filter(Boolean).join('\n');
  const outputLines = persistedOutput.split(/\r?\n/);
  const durationMs = input.completedAt.getTime() - input.startedAt.getTime();
  const resultText = input.stopped ? '已终止' : input.success ? '成功' : '失败';
  const visualChecks = input.visualChecks || [];
  const visualCheckByStepId = new Map(visualChecks.map((check) => [check.nodeId, check]));
  const visualFailureCount = visualChecks.filter((check) => check.status === 'failed').length;
  const html = htmlReportPath ? createReplayHtml({
    video: input.video ? {
      startedAt: input.video.startedAt,
      url: relative(outputDir, input.video.filePath).split(/[/\\\\]/).map(encodeURIComponent).join('/'),
      segments: (input.video.segments || [input.video]).map(segment => ({
        startedAt: segment.startedAt, boundaryAt: segment.boundaryAt, scriptName: segment.scriptName,
        url: relative(outputDir, segment.filePath).split(/[/\\\\]/).map(encodeURIComponent).join('/'),
      })),
    } : undefined,
    script: input.script,
    deviceId: input.deviceId,
    resultText,
    durationMs,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    frames: input.frames || [],
    visualChecks,
    imageChecks: input.imageChecks,
    output: persistedOutput,
  }) : '';
  const markdown = [
    '# Appium 回放报告',
    '',
    '| 项目 | 内容 |',
    '| --- | --- |',
    `| 脚本名称 | ${markdownValue(input.script.name)} |`,
    `| 脚本 ID | ${markdownValue(input.script.id)} |`,
    `| App 包名 | ${markdownValue(input.script.appPackage)} |`,
    `| App Activity | ${markdownValue(input.script.appActivity)} |`,
    `| 设备 ID | ${markdownValue(input.deviceId)} |`,
    `| 开始时间 | ${input.startedAt.toLocaleString()} |`,
    `| 完成时间 | ${input.completedAt.toLocaleString()} |`,
    `| 总耗时 | ${durationMs}ms |`,
    `| 执行结果 | **${resultText}** |`,
    `| 节点数量 | ${input.script.steps.length} |`,
    `| 截图帧数 | ${(input.frames || []).length} |`,
    `| 视觉检测未达预期 | ${visualFailureCount} |`,
    `| 截图回放 | ${htmlReportPath ? markdownValue(htmlReportPath) : '未开启'} |`,
    '',
    '## 节点明细',
    '',
    ...input.script.steps.map((step, index) => stepSection(step, index, outputLines, visualCheckByStepId.get(step.id))),
    '## 完整回放日志',
    '',
    '```text',
    persistedOutput || '-',
    '```',
    '',
  ].join('\n');
  await Promise.all([
    writeFile(filePath, markdown, 'utf8'),
    writeFile(logPath, `${persistedOutput}\n`, 'utf8'),
    ...(htmlReportPath ? [writeFile(htmlReportPath, html, 'utf8')] : []),
  ]);
  const record = saveAppiumReplayReport({
    scriptId: input.script.id,
    scriptName: input.script.name,
    success: input.success,
    filePath,
    logPath,
    htmlPath: htmlReportPath,
    startedAt: input.startedAt.toISOString(),
    completedAt: input.completedAt.toISOString(),
  });
  return { id: record.id, filePath, fileName, logPath, logFileName, htmlReportPath, htmlFileName };
}
