import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import { canManageConfig, publicConfig, resolveSavedModelKey } from './config-access';
import { SAVED_API_KEY } from '../src/config/credentials';
import type { AppConfig } from './config';

test('configuration access requires a loopback client and matching browser origin', () => {
  const request = (address: string, origin?: string) => ({ socket: { remoteAddress: address }, headers: { host: 'localhost:5173', origin } }) as IncomingMessage;
  assert.equal(canManageConfig(request('192.0.2.10')), false);
  assert.equal(canManageConfig(request('127.0.0.1', 'https://foreign.example')), false);
  assert.equal(canManageConfig(request('::1', 'http://localhost:5173')), true);
  assert.equal(canManageConfig(request('::ffff:127.0.0.1')), true);
});

test('public config masks every key and server env without modifying stored values; masked keys cannot move to another endpoint', () => {
  const model = { baseUrl: 'https://model.example/v1', apiKey: 'private-secret', name: 'model' };
  const stored = { runtime: { androidSdkPath: '', reportOutputPath: '' }, midscene: { model: { ...model, provider: 'custom', family: 'gpt-5' }, env: { SECRET: 'secret-env' } }, scriptOptimizer: { model }, appium: { model, promptOptimizer: { model } } } as AppConfig;
  const output = publicConfig(stored);
  assert.equal(JSON.stringify(output).includes('private-secret'), false);
  assert.deepEqual(output.midscene.env, {});
  assert.equal(stored.midscene.model.apiKey, 'private-secret');
  assert.equal(resolveSavedModelKey({ ...model, apiKey: SAVED_API_KEY }, model), 'private-secret');
  assert.throws(() => resolveSavedModelKey({ ...model, baseUrl: 'https://other.example', apiKey: SAVED_API_KEY }, model), /重新输入/);
  assert.throws(() => resolveSavedModelKey({ ...model, provider: 'codex', apiKey: SAVED_API_KEY }, model), /重新输入/);
  assert.equal(resolveSavedModelKey({ ...model, apiKey: 'replacement' }, model), 'replacement');
});
