import {
  createDeviceSessionRecord,
  expireStaleDeviceSessions,
  getActiveDeviceSessionRecord,
  listDeviceSessionRecords,
  touchDeviceSessionRecord,
} from './repository';
import type { DeviceSessionPatch } from './types';

const SESSION_TTL_MS = 30 * 60 * 1000;
const SESSION_IDLE_TTL_MS = 10 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function addMs(timestamp: string, ms: number) {
  return new Date(new Date(timestamp).getTime() + ms).toISOString();
}

// 复用同一设备的活动 session；不存在或过期时才创建新 session，避免页面切换导致设备状态丢失。
export function ensureDeviceSession(input: { deviceId: string; patch?: DeviceSessionPatch }) {
  if (!input.deviceId) {
    throw new Error('设备 ID 不能为空');
  }

  const now = nowIso();
  expireStaleDeviceSessions(now);
  const existing = getActiveDeviceSessionRecord(input.deviceId, now);
  const idleExpiresAt = addMs(now, SESSION_IDLE_TTL_MS);

  if (existing) {
    touchDeviceSessionRecord({
      sessionId: existing.id,
      now,
      idleExpiresAt,
      patch: input.patch,
    });
    return getActiveDeviceSessionRecord(input.deviceId, now) || existing;
  }

  const created = createDeviceSessionRecord({
    deviceId: input.deviceId,
    now,
    expiresAt: addMs(now, SESSION_TTL_MS),
    idleExpiresAt,
    patch: input.patch,
  });

  if (!created) {
    throw new Error('创建设备会话失败');
  }
  return created;
}

export function listDeviceSessions() {
  expireStaleDeviceSessions(nowIso());
  return listDeviceSessionRecords();
}
