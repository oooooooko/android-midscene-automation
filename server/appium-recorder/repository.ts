import {
  createId,
  querySql,
  runSql,
  sqlJson,
  sqlNullableString,
  sqlString,
} from '../storage/sqlite';
import { normalizeLegacyNestedConditionBranches } from '../../src/appium-recorder/flow-normalize';

export type AppiumRecordedStepRecord = {
  id: string;
  type:
    | 'tap'
    | 'input'
    | 'tapIfExists'
    | 'inputIfExists'
    | 'clearIfExists'
    | 'backIfExists'
    | 'waitFor'
    | 'assertExists'
    | 'key'
    | 'waitActivity'
    | 'delay'
    | 'clearInput'
    | 'coordinateTap'
    | 'swipe'
    | 'screenshot'
    | 'launchApp'
    | 'clearAppData'
    | 'waitDisappear'
    | 'assertText'
    | 'longPress'
    | 'pinch'
    | 'runScript'
    | 'noop'
    | 'visualChange';
  label: string;
  note?: string;
  selector?: {
    strategy: 'accessibilityId' | 'id' | 'androidUiAutomator' | 'xpath' | 'bounds';
    value?: string;
    centerX?: number;
    centerY?: number;
    unique?: boolean;
    matchCount?: number;
    source?: 'node' | 'ancestor' | 'fallback';
  };
  contextSelector?: {
    strategy: 'accessibilityId' | 'id' | 'androidUiAutomator' | 'xpath' | 'bounds';
    value?: string;
    centerX?: number;
    centerY?: number;
    unique?: boolean;
    matchCount?: number;
    source?: 'node' | 'ancestor' | 'fallback';
  };
  selectorChain?: Array<{
    strategy: 'accessibilityId' | 'id' | 'androidUiAutomator' | 'xpath' | 'bounds';
    value?: string;
    centerX?: number;
    centerY?: number;
    unique?: boolean;
    matchCount?: number;
    source?: 'node' | 'ancestor' | 'fallback';
  }>;
  fallback?: {
    strategy: 'accessibilityId' | 'id' | 'androidUiAutomator' | 'xpath' | 'bounds';
    value?: string;
    centerX?: number;
    centerY?: number;
    unique?: boolean;
    matchCount?: number;
    source?: 'node' | 'ancestor' | 'fallback';
  };
  value?: string;
  optional?: boolean;
  keyCode?: number;
  timeoutMs?: number;
  flow?: {
    nodeKind?: 'action' | 'condition' | 'assertion';
    yesTargetId?: string;
    noTargetId?: string;
    parentConditionId?: string;
    parentBranch?: 'yes' | 'no';
    successTargetId?: string;
    failureTargetId?: string;
    textMatch?: 'contains' | 'exact';
    collapsed?: boolean;
  };
  pageBefore?: {
    activity?: string;
    packageName?: string;
    treeSignature?: string;
    selectedNodePath?: string;
  };
  pageAfter?: {
    activity?: string;
    packageName?: string;
    treeSignature?: string;
    selectedNodePath?: string;
  };
  swipe?: {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    duration: number;
  };
  pinch?: {
    direction: 'in' | 'out';
    centerX: number;
    centerY: number;
    percent: number;
  };
  visualChange?: {
    mode: 'selectedElement' | 'region';
    region: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    role?: 'start' | 'end';
    pairId?: string;
    pairLabel?: string;
    startStepId?: string;
    endStepId?: string;
    durationMs: number;
    intervalMs: number;
    changeRatioThreshold: number;
    pixelmatchThreshold: number;
  };
  snapshot?: {
    text: string;
    resourceId: string;
    contentDesc: string;
    className: string;
  };
};

export type AppiumRecordedScriptRecord = {
  id: string;
  name: string;
  appPackage: string;
  appActivity: string;
  deviceId: string;
  steps: AppiumRecordedStepRecord[];
  createdAt: string;
  updatedAt: string;
};

type AppiumRecordedScriptRow = {
  id: string;
  name: string;
  app_package: string;
  app_activity: string | null;
  device_id: string | null;
  flow_json: string | null;
  created_at: string;
  updated_at: string;
};

export type AppiumReplayReportRecord = {
  id: string;
  scriptId: string;
  scriptName: string;
  success: boolean;
  filePath: string;
  logPath: string;
  htmlPath: string;
  startedAt: string;
  completedAt: string;
  createdAt: string;
};

let initialized = false;

function createAppiumRecordedScriptsTable() {
  runSql(`
    CREATE TABLE IF NOT EXISTS appium_recorded_scripts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      app_package TEXT NOT NULL,
      app_activity TEXT,
      device_id TEXT,
      flow_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_appium_recorded_scripts_updated_at
      ON appium_recorded_scripts(updated_at DESC);
  `);
}

function createAppiumReplayReportsTable() {
  runSql(`
    CREATE TABLE IF NOT EXISTS appium_replay_reports (
      id TEXT PRIMARY KEY,
      script_id TEXT NOT NULL,
      script_name TEXT NOT NULL,
      success INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      log_path TEXT,
      html_path TEXT,
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_appium_replay_reports_script_id
      ON appium_replay_reports(script_id, created_at DESC);
  `);
}

function initDb() {
  if (initialized) return;
  initialized = true;
  createAppiumRecordedScriptsTable();
  createAppiumReplayReportsTable();
  const columns = querySql<{ name: string }>('PRAGMA table_info(appium_recorded_scripts);').map((column) => column.name);
  if (columns.includes('steps_json') || !columns.includes('flow_json')) {
    runSql('DROP TABLE appium_recorded_scripts;');
    createAppiumRecordedScriptsTable();
  }
  const reportColumns = querySql<{ name: string }>('PRAGMA table_info(appium_replay_reports);')
    .map((column) => column.name);
  if (!reportColumns.includes('log_path')) {
    runSql('ALTER TABLE appium_replay_reports ADD COLUMN log_path TEXT;');
  }
  if (!reportColumns.includes('html_path')) {
    runSql('ALTER TABLE appium_replay_reports ADD COLUMN html_path TEXT;');
  }
}

function parseStepList(value?: string | null) {
  try {
    const parsed = JSON.parse(value || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((step) => (
      step
      && typeof step === 'object'
      && typeof step.id === 'string'
      && typeof step.type === 'string'
    )) as AppiumRecordedStepRecord[];
  } catch {
    return [];
  }
}

function normalizeScriptActivity(
  appPackage: string,
  appActivity: string | null | undefined,
  steps: AppiumRecordedStepRecord[],
) {
  const belongsToApp = (activity?: string) => {
    const value = activity?.trim() || '';
    return value && (!value.includes('/') || value.split('/')[0] === appPackage);
  };
  if (belongsToApp(appActivity || '')) return appActivity?.trim() || '';
  for (const step of steps) {
    for (const activity of [step.pageBefore?.activity, step.pageAfter?.activity]) {
      if (belongsToApp(activity)) return activity?.trim() || '';
    }
  }
  return '';
}

function rowToRecord(row: AppiumRecordedScriptRow): AppiumRecordedScriptRecord {
  const steps = normalizeLegacyNestedConditionBranches(parseStepList(row.flow_json));
  return {
    id: row.id,
    name: row.name,
    appPackage: row.app_package,
    appActivity: normalizeScriptActivity(row.app_package, row.app_activity, steps),
    deviceId: row.device_id || '',
    steps,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listAppiumRecordedScripts() {
  initDb();
  return querySql<AppiumRecordedScriptRow>(`
    SELECT
      id,
      name,
      app_package,
      app_activity,
      device_id,
      flow_json,
      created_at,
      updated_at
    FROM appium_recorded_scripts
    ORDER BY updated_at DESC;
  `).map(rowToRecord);
}

export function getAppiumRecordedScript(id: string) {
  initDb();
  const row = querySql<AppiumRecordedScriptRow>(`
    SELECT
      id,
      name,
      app_package,
      app_activity,
      device_id,
      flow_json,
      created_at,
      updated_at
    FROM appium_recorded_scripts
    WHERE id = ${sqlString(id)}
    LIMIT 1;
  `)[0];
  return row ? rowToRecord(row) : null;
}

export function saveAppiumRecordedScript(input: {
  id?: string;
  name: string;
  appPackage: string;
  appActivity?: string;
  deviceId?: string;
  steps: AppiumRecordedStepRecord[];
}) {
  initDb();
  const now = new Date().toISOString();
  const id = input.id || createId('appium_script');
  const name = input.name.trim();
  const appPackage = input.appPackage.trim();
  const steps = normalizeLegacyNestedConditionBranches(input.steps || []);
  const appActivity = normalizeScriptActivity(appPackage, input.appActivity, steps);

  if (!name) throw new Error('脚本名称不能为空');
  if (!appPackage) throw new Error('App 包名不能为空');

  if (input.id) {
    runSql(`
      INSERT INTO appium_recorded_scripts (
        id,
        name,
        app_package,
        app_activity,
        device_id,
        flow_json,
        created_at,
        updated_at
      )
      VALUES (
        ${sqlString(input.id)},
        ${sqlString(name)},
        ${sqlString(appPackage)},
        ${sqlNullableString(appActivity)},
        ${sqlNullableString(input.deviceId || '')},
        ${sqlJson(steps)},
        ${sqlString(now)},
        ${sqlString(now)}
      )
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        app_package = excluded.app_package,
        app_activity = excluded.app_activity,
        device_id = excluded.device_id,
        flow_json = excluded.flow_json,
        updated_at = excluded.updated_at;
    `);
    return getAppiumRecordedScript(input.id);
  }

  runSql(`
    INSERT INTO appium_recorded_scripts (
      id,
      name,
      app_package,
      app_activity,
      device_id,
      flow_json,
      created_at,
      updated_at
    )
    VALUES (
      ${sqlString(id)},
      ${sqlString(name)},
      ${sqlString(appPackage)},
      ${sqlNullableString(appActivity)},
      ${sqlNullableString(input.deviceId || '')},
      ${sqlJson(steps)},
      ${sqlString(now)},
      ${sqlString(now)}
    )
    ON CONFLICT(name) DO UPDATE SET
      app_package = excluded.app_package,
      app_activity = excluded.app_activity,
      device_id = excluded.device_id,
      flow_json = excluded.flow_json,
      updated_at = excluded.updated_at;
  `);

  return listAppiumRecordedScripts().find((script) => script.name === name) || getAppiumRecordedScript(id);
}

export function deleteAppiumRecordedScript(id: string) {
  initDb();
  runSql(`
    DELETE FROM appium_recorded_scripts
    WHERE id = ${sqlString(id)};
  `);
}

export function importAppiumRecordedScript(input: {
  name: string;
  appPackage: string;
  appActivity?: string;
  deviceId?: string;
  steps: AppiumRecordedStepRecord[];
}) {
  initDb();
  const baseName = input.name.trim() || '导入脚本';
  const existingNames = new Set(listAppiumRecordedScripts().map((script) => script.name));
  let name = baseName;
  let suffix = 2;
  while (existingNames.has(name)) {
    name = `${baseName} (${suffix})`;
    suffix += 1;
  }
  return saveAppiumRecordedScript({ ...input, name });
}

export function saveAppiumReplayReport(input: Omit<AppiumReplayReportRecord, 'id' | 'createdAt'>) {
  initDb();
  const id = createId('appium_report');
  const createdAt = new Date().toISOString();
  runSql(`
    INSERT INTO appium_replay_reports (
      id,
      script_id,
      script_name,
      success,
      file_path,
      log_path,
      html_path,
      started_at,
      completed_at,
      created_at
    ) VALUES (
      ${sqlString(id)},
      ${sqlString(input.scriptId)},
      ${sqlString(input.scriptName)},
      ${input.success ? 1 : 0},
      ${sqlString(input.filePath)},
      ${sqlNullableString(input.logPath)},
      ${sqlNullableString(input.htmlPath)},
      ${sqlString(input.startedAt)},
      ${sqlString(input.completedAt)},
      ${sqlString(createdAt)}
    );
  `);
  return { id, ...input, createdAt };
}
