import { querySql, runSql, sqlJson, sqlString } from '../storage/sqlite';
import { validateVariables, type TestVariable } from '../../src/appium-recorder/variables';

function init() {
  runSql('CREATE TABLE IF NOT EXISTS appium_variables (scope TEXT PRIMARY KEY, value TEXT NOT NULL);');
}
// 预设只在编辑时持久化；回放使用独立快照，不将提取值写回全局。
export function getPresetVariables(scriptId?: string): TestVariable[] {
  init();
  const row = querySql<{ value: string }>(`SELECT value FROM appium_variables WHERE scope=${sqlString(scriptId ? `script:${scriptId}` : 'global')};`)?.[0];
  return validateVariables(row ? JSON.parse(row.value) : []);
}
export function savePresetVariables(variables: TestVariable[], scriptId?: string) {
  const values = validateVariables(variables);
  init();
  runSql(`INSERT INTO appium_variables VALUES (${sqlString(scriptId ? `script:${scriptId}` : 'global')}, ${sqlJson(values)}) ON CONFLICT(scope) DO UPDATE SET value=excluded.value;`);
  return values;
}
export function deleteScriptVariables(scriptId: string) {
  init();
  runSql(`DELETE FROM appium_variables WHERE scope=${sqlString(`script:${scriptId}`)};`);
}
