import { constants, copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export function ensureArtemisConfig(projectDir) {
  const configDir = resolve(projectDir, 'config');
  const target = resolve(configDir, 'artemis.jsonc');
  if (existsSync(target)) return;
  mkdirSync(configDir, { recursive: true });
  try {
    copyFileSync(resolve(configDir, 'artemis.example.jsonc'), target, constants.COPYFILE_EXCL);
  } catch (error) {
    // Never overwrite a user's configuration, including concurrent first starts.
    if (error.code !== 'EEXIST') throw error;
  }
}
