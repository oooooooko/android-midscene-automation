import {
  createId,
  querySql,
  runSql,
  sqlJson,
  sqlNullableString,
  sqlString,
} from '../storage/sqlite';
import type { OperationEventRecord, OperationRecord, OperationStatus } from './types';

type OperationRow = {
  id: string;
  kind: 'script_run';
  status: OperationStatus;
  script_name: string;
  device_id: string;
  session_id: string;
  request_json: string;
  result_json: string | null;
  output: string | null;
  file_path: string | null;
  error_message: string | null;
  created_at: string;
  started_at: string;
  finished_at: string | null;
};

type OperationEventRow = {
  seq: number;
  operation_id: string;
  timestamp: string;
  event_type: string;
  message: string | null;
  data_json: string;
};

let initialized = false;

function rowToOperation(row: OperationRow): OperationRecord {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    scriptName: row.script_name,
    deviceId: row.device_id,
    sessionId: row.session_id,
    request: JSON.parse(row.request_json || '{}') as Record<string, unknown>,
    result: row.result_json ? JSON.parse(row.result_json) as Record<string, unknown> : null,
    output: row.output || '',
    filePath: row.file_path || '',
    errorMessage: row.error_message || '',
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at || '',
  };
}

function rowToEvent(row: OperationEventRow): OperationEventRecord {
  return {
    seq: row.seq,
    operationId: row.operation_id,
    timestamp: row.timestamp,
    eventType: row.event_type,
    message: row.message || '',
    data: JSON.parse(row.data_json || '{}') as Record<string, unknown>,
  };
}

export function initOperationRepository() {
  if (initialized) return;
  initialized = true;
  runSql(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS operations (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      script_name TEXT NOT NULL,
      device_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      request_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT NULL,
      output TEXT NULL,
      file_path TEXT NULL,
      error_message TEXT NULL,
      created_at TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT NULL
    );
    CREATE TABLE IF NOT EXISTS operation_events (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      operation_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      event_type TEXT NOT NULL,
      message TEXT NULL,
      data_json TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_operations_created_at ON operations(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_operations_device_status ON operations(device_id, status);
    CREATE INDEX IF NOT EXISTS idx_operation_events_operation_id_seq ON operation_events(operation_id, seq);
  `);
}

export function createOperationRecord(input: {
  scriptName: string;
  deviceId: string;
  sessionId: string;
  request: Record<string, unknown>;
}) {
  initOperationRepository();
  const id = createId('op');
  const now = new Date().toISOString();
  runSql(`
    INSERT INTO operations (
      id,
      kind,
      status,
      script_name,
      device_id,
      session_id,
      request_json,
      created_at,
      started_at
    )
    VALUES (
      ${sqlString(id)},
      'script_run',
      'running',
      ${sqlString(input.scriptName)},
      ${sqlString(input.deviceId)},
      ${sqlString(input.sessionId)},
      ${sqlJson(input.request)},
      ${sqlString(now)},
      ${sqlString(now)}
    );
  `);
  return getOperationRecord(id);
}

export function getOperationRecord(id: string) {
  initOperationRepository();
  const row = querySql<OperationRow>(`
    SELECT *
    FROM operations
    WHERE id = ${sqlString(id)}
    LIMIT 1;
  `)[0];
  return row ? rowToOperation(row) : null;
}

export function listOperationRecords(limit = 30) {
  initOperationRepository();
  return querySql<OperationRow>(`
    SELECT *
    FROM operations
    ORDER BY datetime(created_at) DESC
    LIMIT ${Math.max(1, Math.min(100, Math.floor(limit)))};
  `).map(rowToOperation);
}

export function finishOperationRecord(input: {
  id: string;
  status: OperationStatus;
  result?: Record<string, unknown> | null;
  output?: string;
  filePath?: string;
  errorMessage?: string;
}) {
  initOperationRepository();
  const now = new Date().toISOString();
  runSql(`
    UPDATE operations
    SET
      status = ${sqlString(input.status)},
      result_json = ${input.result === undefined ? 'result_json' : input.result === null ? 'NULL' : sqlJson(input.result)},
      output = COALESCE(${input.output !== undefined ? sqlString(input.output) : 'NULL'}, output),
      file_path = COALESCE(${sqlNullableString(input.filePath)}, file_path),
      error_message = COALESCE(${sqlNullableString(input.errorMessage)}, error_message),
      finished_at = ${sqlString(now)}
    WHERE id = ${sqlString(input.id)};
  `);
  return getOperationRecord(input.id);
}

export function appendOperationEventRecord(input: {
  operationId: string;
  eventType: string;
  message?: string;
  data?: Record<string, unknown>;
}) {
  initOperationRepository();
  runSql(`
    INSERT INTO operation_events (
      operation_id,
      timestamp,
      event_type,
      message,
      data_json
    )
    VALUES (
      ${sqlString(input.operationId)},
      ${sqlString(new Date().toISOString())},
      ${sqlString(input.eventType)},
      ${sqlNullableString(input.message)},
      ${sqlJson(input.data || {})}
    );
  `);
}

export function listOperationEventRecords(operationId: string) {
  initOperationRepository();
  return querySql<OperationEventRow>(`
    SELECT *
    FROM operation_events
    WHERE operation_id = ${sqlString(operationId)}
    ORDER BY seq ASC;
  `).map(rowToEvent);
}
