export type DeviceLockOwnerType = 'script_run' | 'manual_action' | 'preview';

export type DeviceLockRecord = {
  id: string;
  deviceId: string;
  ownerType: DeviceLockOwnerType;
  ownerId: string;
  metadata: Record<string, unknown>;
  acquiredAt: string;
  expiresAt: string;
  releasedAt: string;
};

export class DeviceLockConflictError extends Error {
  readonly conflict: DeviceLockRecord;

  constructor(conflict: DeviceLockRecord) {
    super(`设备 ${conflict.deviceId} 正在被 ${conflict.ownerType} 占用`);
    this.name = 'DeviceLockConflictError';
    this.conflict = conflict;
  }
}
