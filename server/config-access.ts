import type { IncomingMessage } from 'node:http';
import type { AppConfig } from './config';
import { SAVED_API_KEY } from '../src/config/credentials';

export function canManageConfig(req: IncomingMessage) {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '')) return false;
  if (!req.headers.origin) return true;
  try { return new URL(req.headers.origin).host === req.headers.host; } catch { return false; }
}

export function publicConfig(config: AppConfig): AppConfig {
  const result = structuredClone(config);
  for (const model of [result.midscene.model, result.scriptOptimizer.model, result.appium.model, result.appium.promptOptimizer?.model]) {
    if (model?.apiKey) model.apiKey = SAVED_API_KEY;
  }
  // Runtime environment overrides are only consumed by the server.
  result.midscene.env = {};
  return result;
}

export function resolveSavedModelKey(model: { apiKey?: string; baseUrl?: string; provider?: string }, stored?: { apiKey: string; baseUrl: string; provider?: string }) {
  if (model.apiKey !== SAVED_API_KEY) return model.apiKey || '';
  if (!stored || model.baseUrl?.trim().replace(/\/+$/, '') !== stored.baseUrl.trim().replace(/\/+$/, '') || model.provider !== stored.provider) {
    throw new Error('模型连接地址或提供方已改变，请重新输入 API Key');
  }
  return stored.apiKey;
}
