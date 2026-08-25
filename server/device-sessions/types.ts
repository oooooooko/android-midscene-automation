export type DeviceSessionStatus = 'active' | 'expired' | 'closed';

export type DeviceSessionRecord = {
  id: string;
  deviceId: string;
  status: DeviceSessionStatus;
  playgroundUrl: string;
  previewKind: string;
  sessionConnected: boolean;
  setupState: string;
  previewError: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  idleExpiresAt: string;
};

export type DeviceSessionPatch = {
  playgroundUrl?: string;
  previewKind?: string;
  sessionConnected?: boolean;
  setupState?: string;
  previewError?: string;
};
