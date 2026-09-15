export type TestVariable = { name: string; value: string; sensitive?: boolean };
export type VariableExtraction = { name: string; attribute: string; sensitive?: boolean };
export type ScriptReturn = { name: string; target: string };
export const VARIABLE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const sensitiveVariableName = (name: string) => /password|passwd|secret|token|api_?key|密码|令牌/i.test(name);

export function validateVariables(input: unknown): TestVariable[] {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > 200) throw new Error('变量必须为列表，最多 200 项');
  const names = new Set<string>();
  return input.map(item => {
    if (!item || typeof item.name !== 'string' || !VARIABLE_NAME.test(item.name) || item.name.length > 80) throw new Error('变量名须以字母或下划线开头，仅含字母、数字、下划线，最长 80 字符');
    if (names.has(item.name)) throw new Error(`变量名重复：${item.name}`);
    names.add(item.name);
    if (typeof item.value !== 'string' || item.value.length > 20000) throw new Error(`变量 ${item.name} 的值必须为文本且不超过 20000 字符`);
    return { name: item.name, value: item.value, sensitive: Boolean(item.sensitive) || sensitiveVariableName(item.name) };
  });
}

export function validateExtraction(input: VariableExtraction | undefined) {
  if (!input || !VARIABLE_NAME.test(input.name) || !input.attribute?.trim()) throw new Error('请填写有效变量名和组件属性');
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(input.attribute)) throw new Error('组件属性名称无效');
  return input;
}

export function validateReturns(input: ScriptReturn[] = []) {
  if (!Array.isArray(input) || input.length > 200) throw new Error('返回值映射无效');
  const targets = new Set<string>();
  for (const item of input) {
    if (!item || !VARIABLE_NAME.test(item.name) || !VARIABLE_NAME.test(item.target) || targets.has(item.target)) throw new Error('返回变量名或目标变量名无效、重复');
    targets.add(item.target);
  }
  return input;
}
