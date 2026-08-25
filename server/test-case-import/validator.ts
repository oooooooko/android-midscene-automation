import type { ParsedTestCaseDocument } from './types';

const MAX_EXTRACTED_TEXT_LENGTH = 100_000;
const structurePattern = /测试用例|用例名称|用例标题|测试场景|前置条件|测试步骤|操作步骤|预期结果|期望结果|test\s*case|precondition|expected/i;
const actionPattern = /打开|启动|进入|点击|选择|输入|填写|提交|登录|注册|搜索|切换|滑动|等待|关闭|允许|同意|检查|验证|操作|执行/i;
const assertionPattern = /预期|期望|结果|成功|失败|显示|出现|跳转|进入首页|提示|返回|应当|应该|不存在|可见/i;

function countMatches(text: string, pattern: RegExp) {
  const globalPattern = new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`);
  return (text.match(globalPattern) || []).length;
}

// 结构化用例优先通过；非结构化文本必须同时具备操作和结果语义，避免导入普通文章。
export function validateTestCaseDocument(document: ParsedTestCaseDocument) {
  if (!document.rawText.trim()) {
    throw new Error('文件内容为空，未读取到测试用例');
  }
  if (document.rawText.length > MAX_EXTRACTED_TEXT_LENGTH) {
    throw new Error('测试用例内容过长，请控制在 10 万个字符以内');
  }

  const hasCanonicalCase = document.cases.some(
    (item) => item.steps.length > 0 && item.expectedResults.length > 0,
  );
  const structureCount = countMatches(document.rawText, structurePattern);
  const actionCount = countMatches(document.rawText, actionPattern);
  const assertionCount = countMatches(document.rawText, assertionPattern);
  const hasStructuredTestText = structureCount >= 2 && actionCount >= 1;
  const hasBehaviorTestText = actionCount >= 2 && assertionCount >= 1 && document.rawText.length >= 20;

  if (!hasCanonicalCase && !hasStructuredTestText && !hasBehaviorTestText) {
    throw new Error('文件内容与测试用例无关，请上传包含测试步骤、操作动作和预期结果的用例文件');
  }
}
