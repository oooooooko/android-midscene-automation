import {
  findActiveDeviceLockRecord,
  insertDeviceLockRecord,
  listActiveDeviceLockRecords,
  refreshDeviceLockRecord,
  releaseDeviceLockRecord,
} from './repository';
import { DeviceLockConflictError, type DeviceLockOwnerType } from './types';

const DEFAULT_LOCK_TTL_MS = 15 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function addMs(timestamp: string, ms: number) {
  return new Date(new Date(timestamp).getTime() + ms).toISOString();
}

// 设备锁是脚本执行的并发保护：同一台手机同一时间只允许一个 owner 操作。
export function acquireDeviceLock(input: {
  deviceId: string;
  ownerType: DeviceLockOwnerType;
  ownerId: string;
  ttlMs?: number;
  metadata?: Record<string, unknown>;
}) {
  if (!input.deviceId) {
    throw new Error('设备 ID 不能为空');
  }

  const now = nowIso();
  const expiresAt = addMs(now, input.ttlMs || DEFAULT_LOCK_TTL_MS);
  const active = findActiveDeviceLockRecord(input.deviceId, now);

  if (active && active.ownerId !== input.ownerId) {
    throw new DeviceLockConflictError(active);
  }

  if (active) {
    refreshDeviceLockRecord({ lockId: active.id, expiresAt });
    return { ...active, expiresAt };
  }

  const id = insertDeviceLockRecord({
    deviceId: input.deviceId,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    metadata: input.metadata || {},
    acquiredAt: now,
    expiresAt,
  });

  return {
    id,
    deviceId: input.deviceId,
    ownerType: input.ownerType,
    ownerId: input.ownerId,
    metadata: input.metadata || {},
    acquiredAt: now,
    expiresAt,
    releasedAt: '',
  };
}

export function releaseDeviceLock(ownerId: string) {
  releaseDeviceLockRecord(ownerId, nowIso());
}

export function listActiveDeviceLocks() {
  return listActiveDeviceLockRecords(nowIso());
}
