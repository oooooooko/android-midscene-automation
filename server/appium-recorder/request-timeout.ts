import { AsyncLocalStorage } from 'node:async_hooks';

const deadline = new AsyncLocalStorage<number>();
export class AppiumRequestTimeoutError extends Error {}

export function withElementDeadline<T>(timeoutMs: number, action: () => Promise<T>) {
  return deadline.run(Date.now() + Math.max(1, timeoutMs), action);
}

// 响应体也受同一个期限约束，避免收到 HTTP 头后继续无限等待。
export async function timedAppiumFetch(url: string, init: RequestInit, timeoutMs: number) {
  const remaining = Math.max(1, Math.min(timeoutMs, (deadline.getStore() ?? Infinity) - Date.now()));
  const timeout = AbortSignal.timeout(Math.ceil(remaining));
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  try {
    const response = await fetch(url, { ...init, signal });
    const text = await response.text();
    return { response, text };
  } catch (error) {
    if (timeout.aborted && !init.signal?.aborted) {
      throw new AppiumRequestTimeoutError(`设备自动化服务无响应：Appium 请求超过 ${Math.ceil(remaining)}ms，已停止等待（${url}）`);
    }
    throw error;
  }
}
