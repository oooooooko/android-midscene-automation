import {
  createId,
  querySql,
  runSql,
  sqlJson,
  sqlString,
} from '../storage/sqlite';
import type { DeviceLockOwnerType, DeviceLockRecord } from './types';

type DeviceLockRow = {
  id: string;
  device_id: string;
  owner_type: DeviceLockOwnerType;
  owner_id: string;
  metadata_json: string;
  acquired_at: string;
  expires_at: string;
  released_at: string | null;
};

let initialized = false;

function rowToRecord(row: DeviceLockRow): DeviceLockRecord {
  return {
    id: row.id,
    deviceId: row.device_id,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    metadata: JSON.parse(row.metadata_json || '{}') as Record<string, unknown>,
    acquiredAt: row.acquired_at,
    expiresAt: row.expires_at,
    releasedAt: row.released_at || '',
  };
}

export function initDeviceLockRepository() {
  if (initialized) return;
  initialized = true;
  runSql(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS device_locks (
      id TEXT PRIMARY KEY,
      device_id TEXT NOT NULL,
      owner_type TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      acquired_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      released_at TEXT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_device_locks_active
      ON device_locks(device_id, released_at, expires_at);
    CREATE INDEX IF NOT EXISTS idx_device_locks_owner
      ON device_locks(owner_id);
  `);
}

export function cleanupExpiredDeviceLocks(now: string) {
  initDeviceLockRepository();
  runSql(`
    UPDATE device_locks
    SET released_at = ${sqlString(now)}
    WHERE released_at IS NULL
      AND datetime(expires_at) <= datetime(${sqlString(now)});
  `);
}

export function listActiveDeviceLockRecords(now: string) {
  initDeviceLockRepository();
  cleanupExpiredDeviceLocks(now);
  return querySql<DeviceLockRow>(`
    SELECT *
    FROM device_locks
    WHERE released_at IS NULL
      AND datetime(expires_at) > datetime(${sqlString(now)})
    ORDER BY datetime(acquired_at) DESC;
  `).map(rowToRecord);
}

export function findActiveDeviceLockRecord(deviceId: string, now: string) {
  initDeviceLockRepository();
  cleanupExpiredDeviceLocks(now);
  const row = querySql<DeviceLockRow>(`
    SELECT *
    FROM device_locks
    WHERE device_id = ${sqlString(deviceId)}
      AND released_at IS NULL
      AND datetime(expires_at) > datetime(${sqlString(now)})
    ORDER BY datetime(acquired_at) DESC
    LIMIT 1;
  `)[0];

  return row ? rowToRecord(row) : null;
}

export function insertDeviceLockRecord(input: {
  deviceId: string;
  ownerType: DeviceLockOwnerType;
  ownerId: string;
  metadata: Record<string, unknown>;
  acquiredAt: string;
  expiresAt: string;
}) {
  initDeviceLockRepository();
  const id = createId('dlock');
  runSql(`
    INSERT INTO device_locks (
      id,
      device_id,
      owner_type,
      owner_id,
      metadata_json,
      acquired_at,
      expires_at
    )
    VALUES (
      ${sqlString(id)},
      ${sqlString(input.deviceId)},
      ${sqlString(input.ownerType)},
      ${sqlString(input.ownerId)},
      ${sqlJson(input.metadata)},
      ${sqlString(input.acquiredAt)},
      ${sqlString(input.expiresAt)}
    );
  `);
  return id;
}

export function refreshDeviceLockRecord(input: { lockId: string; expiresAt: string }) {
  initDeviceLockRepository();
  runSql(`
    UPDATE device_locks
    SET expires_at = ${sqlString(input.expiresAt)}
    WHERE id = ${sqlString(input.lockId)}
      AND released_at IS NULL;
  `);
}

export function releaseDeviceLockRecord(ownerId: string, releasedAt: string) {
  initDeviceLockRepository();
  runSql(`
    UPDATE device_locks
    SET released_at = ${sqlString(releasedAt)}
    WHERE owner_id = ${sqlString(ownerId)}
      AND released_at IS NULL;
  `);
}
