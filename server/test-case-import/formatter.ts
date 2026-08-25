import type { ImportedTestCase } from './types';

function appendBulletSection(lines: string[], title: string, values: string[]) {
  if (!values.length) return;
  lines.push(`### ${title}`, ...values.map((value) => `- ${value}`), '');
}

function appendNumberedSection(lines: string[], title: string, values: string[]) {
  if (!values.length) return;
  lines.push(`### ${title}`, ...values.map((value, index) => `${index + 1}. ${value}`), '');
}

// 输出稳定的 Markdown 结构，便于用户阅读，也便于脚本生成模型识别字段边界。
export function formatTestCases(fileName: string, cases: ImportedTestCase[]) {
  const lines = ['# 测试用例', '', `来源文件：${fileName}`, `用例数量：${cases.length}`, ''];

  cases.forEach((item, index) => {
    lines.push(`## 用例 ${index + 1}：${item.title || `未命名用例 ${index + 1}`}`, '');
    if (item.priority) lines.push(`优先级：${item.priority}`, '');
    appendBulletSection(lines, '前置条件', item.preconditions);
    appendNumberedSection(lines, '测试步骤', item.steps);
    appendNumberedSection(lines, '预期结果', item.expectedResults);
    appendBulletSection(lines, '测试数据', item.testData);
    appendBulletSection(lines, '测试描述', item.description);
  });

  return lines.join('\n').trim();
}
