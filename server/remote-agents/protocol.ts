export type RemoteAgentDevice = {
  id: string;
  status: string;
  model?: string;
  description?: string;
};

export type RemoteCommandType =
  | 'screenshot'
  | 'displayInfo'
  | 'tree'
  | 'tap'
  | 'swipe'
  | 'key'
  | 'replay';

export type RemoteCommand = {
  id: string;
  type: RemoteCommandType;
  deviceId: string;
  payload?: Record<string, unknown>;
};

export type RemoteCommandResult = {
  commandId: string;
  ok: boolean;
  data?: unknown;
  error?: string;
};

export type RemoteAndroidDevice = {
  id: string;
  status: string;
  description: string;
  source: 'remote';
  agentId: string;
  deviceSerial: string;
};
