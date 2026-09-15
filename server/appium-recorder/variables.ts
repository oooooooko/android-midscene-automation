import { AsyncLocalStorage } from 'node:async_hooks';
import { sensitiveVariableName, validateVariables, validateReturns, type TestVariable, type ScriptReturn } from '../../src/appium-recorder/variables';
import type { AppiumRecordedStepRecord } from './repository';

export class VariableScope {
  readonly locals = new Map<string, TestVariable & { literal?: boolean }>();
  readonly globals: Map<string, TestVariable>;
  readonly secrets: Set<string>;
  readonly privacy: { enabled: boolean };
  constructor(globals: TestVariable[], locals: TestVariable[], parent?: VariableScope) {
    this.globals = parent?.globals || new Map(validateVariables(globals).map(item => [item.name, item]));
    this.secrets = parent?.secrets || new Set();
    this.privacy = parent?.privacy || { enabled: false };
    for (const item of this.globals.values()) this.track(item);
    for (const item of validateVariables(locals)) this.set(item);
  }
  track(item: TestVariable) {
    if (item.sensitive || sensitiveVariableName(item.name)) {
      this.privacy.enabled = true;
      if (item.value) this.secrets.add(item.value);
    }
  }
  set(item: TestVariable, literal = false) {
    const value = validateVariables([item])[0];
    value.sensitive ||= this.locals.get(value.name)?.sensitive || this.globals.get(value.name)?.sensitive;
    this.track(value);
    this.locals.set(value.name, { ...value, literal });
  }
  resolve(value: string, chain: string[] = []): { value: string; sensitive: boolean } {
    let sensitive = false;
    const resolved = value.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (_match, name: string) => {
      if (chain.includes(name)) throw new Error(`变量循环引用：${[...chain, name].join(' -> ')}`);
      const item: (TestVariable & { literal?: boolean }) | undefined = this.locals.get(name) || this.globals.get(name);
      if (!item) throw new Error(`变量未定义：${name}`);
      const next = item.literal ? { value: item.value, sensitive: Boolean(item.sensitive) } : this.resolve(item.value, [...chain, name]);
      sensitive ||= Boolean(item.sensitive) || sensitiveVariableName(name) || next.sensitive;
      if (sensitive && next.value) this.secrets.add(next.value);
      return next.value;
    });
    if (sensitive) { this.privacy.enabled = true; if (resolved) this.secrets.add(resolved); }
    return { value: resolved, sensitive };
  }
  child(defaults: TestVariable[], params: TestVariable[] = []) {
    const child = new VariableScope([], defaults, this);
    for (const item of validateVariables(params)) {
      const resolved = this.resolve(item.value);
      child.set({ ...item, value: resolved.value, sensitive: item.sensitive || resolved.sensitive }, true);
    }
    return child;
  }
  acceptReturns(child: VariableScope, mappings: ScriptReturn[] = []) {
    // 先校验全部返回值，缺失时不能只写回一半。
    const values = validateReturns(mappings).map(mapping => {
      const item = child.locals.get(mapping.name);
      if (!item) throw new Error(`子脚本未产生返回变量：${mapping.name}`);
      const resolved = child.resolve(`{{${mapping.name}}}`);
      return { name: mapping.target, value: resolved.value, sensitive: item.sensitive || resolved.sensitive };
    });
    values.forEach(item => this.set(item, true));
  }
  redact(text: string) {
    let result = text;
    for (const secret of [...this.secrets].sort((a, b) => b.length - a.length)) {
      for (const variant of new Set([secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret), JSON.stringify([...secret])])) {
        if (variant) result = result.split(variant).join('[已脱敏]');
      }
    }
    return result;
  }
  scrub<T>(value: T): T {
    if (typeof value === 'string') return this.redact(value) as T;
    if (Array.isArray(value)) return value.map(item => this.scrub(item)) as T;
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, this.scrub(item)])) as T;
    return value;
  }
}

export const variableContext = new AsyncLocalStorage<VariableScope>();
export function resolveVariableStep(step: AppiumRecordedStepRecord) {
  const scope = variableContext.getStore();
  if (!scope) return step;
  const resolve = (value: string | undefined) => value === undefined ? value : scope.resolve(value).value;
  const selector = (item: typeof step.selector) => item ? { ...item, value: resolve(item.value) } : item;
  return { ...step, label: resolve(step.label)!, note: resolve(step.note),
    value: step.type === 'runScript' ? step.value : resolve(step.value), logPrefix: resolve(step.logPrefix),
    selector: selector(step.selector), fallback: selector(step.fallback), contextSelector: selector(step.contextSelector),
    selectorChain: step.selectorChain?.map(item => selector(item)!),
  };
}
