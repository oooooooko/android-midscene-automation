import { AsyncLocalStorage } from 'node:async_hooks';
import { ConditionTimeoutError } from './condition-timeout';

const deadline = new AsyncLocalStorage<number>();
export class AppiumRequestTimeoutError extends Error {}

export function withElementDeadline<T>(timeoutMs: number, action: () => Promise<T>) {
  return deadline.run(Date.now() + Math.max(1, timeoutMs), action);
}

export function remainingElementDeadlineMs() {
  const value = deadline.getStore();
  return value === undefined ? Number.POSITIVE_INFINITY : value - Date.now();
}

// 响应体也受同一个期限约束，避免收到 HTTP 头后继续无限等待。
export async function timedAppiumFetch(url: string, init: RequestInit, timeoutMs: number) {
  const elementRemaining = remainingElementDeadlineMs();
  if (elementRemaining <= 0) throw new ConditionTimeoutError('元素定位等待期限已到');
  // 节点期限限制是否继续查找；已发出的请求使用独立通信超时，
  // 避免把最后一次正常查询因剩余预算过短误报为服务无响应。
  const timeout = AbortSignal.timeout(Math.ceil(timeoutMs));
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  try {
    const response = await fetch(url, { ...init, signal });
    const text = await response.text();
    return { response, text };
  } catch (error) {
    if (timeout.aborted && !init.signal?.aborted) {
      throw new AppiumRequestTimeoutError(`设备自动化服务无响应：Appium 请求超过 ${Math.ceil(timeoutMs)}ms，已停止等待（${url}）`);
    }
    throw error;
  }
}
