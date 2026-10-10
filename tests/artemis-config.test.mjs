import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ensureArtemisConfig } from '../bin/artemis-config.mjs';

test('first start creates a local config and subsequent starts preserve edits', () => {
  const root = mkdtempSync(join(tmpdir(), 'artemis-config-'));
  try {
    mkdirSync(join(root, 'config'));
    const template = '{ "default": { "provider": "google" } }\n';
    writeFileSync(join(root, 'config/artemis.example.jsonc'), template);
    ensureArtemisConfig(root);
    assert.equal(readFileSync(join(root, 'config/artemis.jsonc'), 'utf8'), template);
    writeFileSync(join(root, 'config/artemis.jsonc'), 'user settings');
    rmSync(join(root, 'config/artemis.example.jsonc'));
    ensureArtemisConfig(root);
    assert.equal(readFileSync(join(root, 'config/artemis.jsonc'), 'utf8'), 'user settings');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('missing template fails explicitly instead of writing empty settings', () => {
  const root = mkdtempSync(join(tmpdir(), 'artemis-config-'));
  try {
    assert.throws(() => ensureArtemisConfig(root), { code: 'ENOENT' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
