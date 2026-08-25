import {
  createId,
  querySql,
  runSql,
  sqlNullableString,
  sqlString,
} from '../storage/sqlite';
import type { DeviceSessionPatch, DeviceSessionRecord, DeviceSessionStatus } from './types';

type DeviceSessionRow = {
  id: string;
  device_id: string;
  status: DeviceSessionStatus;
  playground_url: string | null;
  preview_kind: string | null;
  session_connected: number;
  setup_state: string | null;
  preview_error: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
  idle_expires_at: string;
};

let initialized = false;

function rowToRecord(row: DeviceSessionRow): DeviceSessionRecord {
  return {
    id: row.id,
    deviceId: row.device_id,
    status: row.status,
    playgroundUrl: row.playground_url || '',
    previewKind: row.preview_kind || '',
    sessionConnected: row.session_connected === 1,
    setupState: row.setup_state || '',
    previewError: row.preview_error || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    idleExpiresAt: row.idle_expires_at,
  };
}

export function initDeviceSessionRepository() {
  if (initialized) return;
  initialized = true;
  runSql(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS device_sessions (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      status TEXT NOT NULL,
      playground_url TEXT NULL,
      preview_kind TEXT NULL,
      session_connected INTEGER NOT NULL DEFAULT 0,
      setup_state TEXT NULL,
      preview_error TEXT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      idle_expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_device_sessions_device_status
      ON device_sessions(device_id, status, updated_at DESC);
  `);
}

export function listDeviceSessionRecords() {
  initDeviceSessionRepository();
  return querySql<DeviceSessionRow>(`
    SELECT *
    FROM device_sessions
    ORDER BY datetime(updated_at) DESC
    LIMIT 50;
  `).map(rowToRecord);
}

export function getActiveDeviceSessionRecord(deviceId: string, now: string) {
  initDeviceSessionRepository();
  const row = querySql<DeviceSessionRow>(`
    SELECT *
    FROM device_sessions
    WHERE device_id = ${sqlString(deviceId)}
      AND status = 'active'
      AND datetime(expires_at) > datetime(${sqlString(now)})
      AND datetime(idle_expires_at) > datetime(${sqlString(now)})
    ORDER BY datetime(updated_at) DESC
    LIMIT 1;
  `)[0];

  return row ? rowToRecord(row) : null;
}

export function expireStaleDeviceSessions(now: string) {
  initDeviceSessionRepository();
  runSql(`
    UPDATE device_sessions
    SET status = 'expired', updated_at = ${sqlString(now)}
    WHERE status = 'active'
      AND (
        datetime(expires_at) <= datetime(${sqlString(now)})
        OR datetime(idle_expires_at) <= datetime(${sqlString(now)})
      );
  `);
}

export function createDeviceSessionRecord(input: {
  deviceId: string;
  now: string;
  expiresAt: string;
  idleExpiresAt: string;
  patch?: DeviceSessionPatch;
}) {
  initDeviceSessionRepository();
  const id = createId('dsess');
  runSql(`
    INSERT INTO device_sessions (
      id,
      device_id,
      status,
      playground_url,
      preview_kind,
      session_connected,
      setup_state,
      preview_error,
      created_at,
      updated_at,
      expires_at,
      idle_expires_at
    )
    VALUES (
      ${sqlString(id)},
      ${sqlString(input.deviceId)},
      'active',
      ${sqlNullableString(input.patch?.playgroundUrl)},
      ${sqlNullableString(input.patch?.previewKind)},
      ${input.patch?.sessionConnected ? 1 : 0},
      ${sqlNullableString(input.patch?.setupState)},
      ${sqlNullableString(input.patch?.previewError)},
      ${sqlString(input.now)},
      ${sqlString(input.now)},
      ${sqlString(input.expiresAt)},
      ${sqlString(input.idleExpiresAt)}
    );
  `);

  return getActiveDeviceSessionRecord(input.deviceId, input.now);
}

export function touchDeviceSessionRecord(input: {
  sessionId: string;
  now: string;
  idleExpiresAt: string;
  patch?: DeviceSessionPatch;
}) {
  initDeviceSessionRepository();
  runSql(`
    UPDATE device_sessions
    SET
      updated_at = ${sqlString(input.now)},
      idle_expires_at = ${sqlString(input.idleExpiresAt)},
      playground_url = COALESCE(${sqlNullableString(input.patch?.playgroundUrl)}, playground_url),
      preview_kind = COALESCE(${sqlNullableString(input.patch?.previewKind)}, preview_kind),
      session_connected = ${input.patch?.sessionConnected === undefined ? 'session_connected' : input.patch.sessionConnected ? 1 : 0},
      setup_state = COALESCE(${sqlNullableString(input.patch?.setupState)}, setup_state),
      preview_error = COALESCE(${sqlNullableString(input.patch?.previewError)}, preview_error)
    WHERE id = ${sqlString(input.sessionId)};
  `);
}
