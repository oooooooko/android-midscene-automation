export const DEFAULT_REPORT_SUMMARY_PROMPT = `请根据提供的回放日志、执行元数据和脚本配置，生成中文 Markdown 测试报告。默认包含：
1. 测试概览：脚本名称、开始时间、结束时间、执行结果（成功/失败/终止）、总时长、设备和 App 信息。
2. 执行配置：主脚本及连接脚本名称、节点类型、参数、超时、分支、循环、AI 识别条件等，用表格展示关键配置。
3. 用例描述表格：序号、所属脚本、测试场景/用例描述、操作步骤、预期结果、实际结果、通过/失败/未执行；循环多次执行时区分尝试次数。
4. 失败详情：失败节点、错误日志证据、实际与预期差异、可能原因及排查建议；没有失败则明确说明。
5. 汇总：执行情况、主要问题、重试结果及建议。
严格依据日志，未执行节点不能计为通过；AI 判断 false 与执行异常要区分。无法确认的信息写“日志未提供”，推测原因明确标为推测。不要编造截图内容或测试结果。只输出 Markdown 正文，不要在全文外包裹代码块。`;

export const IMAGE_GENERATION_TIME_REPORT_SUMMARY_PROMPT = `${DEFAULT_REPORT_SUMMARY_PROMPT}

另外必须包含“出图时间分析”：
- 定位每次触发图片生成的操作，以及其后用于判断已出图的 AI 识别或图像判断节点。
- 首次出图时间必须采用日志中“距观察开始 Nms”或首次命中帧的明确时间，换算为秒并保留两位小数。
- AI 识别耗时或图像判断耗时是包含截图采样、模型请求和响应等待的检测节点总耗时，不能直接作为首次出图时间。
- 如果没有首次命中帧时间，首次出图时间写“日志未提供”，并单独展示检测节点总耗时；不得根据观察时长、超时时间或节点顺序推测。
- 多次生成、循环或重试须逐次列出，表格列为：次数、触发出图操作、检测条件、首次出图时间、检测节点总耗时、判定结果、日志证据。
- 汇总成功出图次数、失败或超时次数、最快、最慢和平均首次出图时间；只有至少两次具有明确时间时才计算平均值。`;

export type ReportSummaryPromptPreset = { name: string; prompt: string };

export const REPORT_SUMMARY_PROMPT_PRESETS: readonly ReportSummaryPromptPreset[] = [
  { name: '默认测试报告', prompt: DEFAULT_REPORT_SUMMARY_PROMPT },
  { name: '出图时间分析', prompt: IMAGE_GENERATION_TIME_REPORT_SUMMARY_PROMPT },
] as const;

export interface ReportSummaryConfig {
  enabled: boolean;
  prompt: string;
  customPresets: ReportSummaryPromptPreset[];
}

export function validateReportSummaryPrompt(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 20000) {
    throw new Error('报告提示词不能为空，且不能超过 20000 字');
  }
  return value.trim();
}

export function resolveReportSummary(value?: Partial<ReportSummaryConfig>): ReportSummaryConfig {
  if (value != null && (typeof value !== 'object' || Array.isArray(value))) throw new Error('回放报告总结配置无效');
  if (value?.enabled !== undefined && typeof value.enabled !== 'boolean') throw new Error('回放报告总结开关无效');
  const prompt = validateReportSummaryPrompt(value?.prompt ?? DEFAULT_REPORT_SUMMARY_PROMPT);
  const rawPresets = value?.customPresets;
  if (rawPresets !== undefined && !Array.isArray(rawPresets)) throw new Error('报告测试场景必须是列表');
  if ((rawPresets?.length || 0) > 50) throw new Error('报告测试场景不能超过 50 个');
  const reservedNames = new Set(REPORT_SUMMARY_PROMPT_PRESETS.map(preset => preset.name));
  const names = new Set<string>();
  const customPresets = (rawPresets || []).map(item => {
    const name = typeof item?.name === 'string' ? item.name.trim() : '';
    if (!name || name.length > 80) throw new Error('报告测试场景名称不能为空，且不能超过 80 字');
    if (reservedNames.has(name) || names.has(name)) throw new Error(`报告测试场景名称已存在：${name}`);
    names.add(name);
    return { name, prompt: validateReportSummaryPrompt(item?.prompt) };
  });
  return {
    enabled: value?.enabled === true,
    prompt,
    customPresets,
  };
}
