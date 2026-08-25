import type { RemoteAgentDevice, RemoteAndroidDevice, RemoteCommand, RemoteCommandResult, RemoteCommandType } from './protocol';

const REMOTE_DEVICE_PREFIX = 'remote:';
const AGENT_TTL_MS = 15_000;
const COMMAND_TIMEOUT_MS = 15_000;
const REPLAY_COMMAND_TIMEOUT_MS = 10 * 60_000;

type RegisteredAgent = {
  id: string;
  name: string;
  version: string;
  devices: RemoteAgentDevice[];
  lastSeenAt: number;
};

type PendingCommand = RemoteCommand & {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const agents = new Map<string, RegisteredAgent>();
const queues = new Map<string, RemoteCommand[]>();
const pending = new Map<string, PendingCommand>();

function validateToken(token?: string) {
  const expected = process.env.REMOTE_AGENT_TOKEN || '';
  if (expected && token !== expected) {
    throw new Error('Remote Agent token 无效');
  }
}

export function isRemoteDeviceId(deviceId: string) {
  return deviceId.startsWith(REMOTE_DEVICE_PREFIX);
}

export function makeRemoteDeviceId(agentId: string, deviceSerial: string) {
  return `${REMOTE_DEVICE_PREFIX}${encodeURIComponent(agentId)}:${encodeURIComponent(deviceSerial)}`;
}

export function parseRemoteDeviceId(deviceId: string) {
  if (!isRemoteDeviceId(deviceId)) return null;
  const raw = deviceId.slice(REMOTE_DEVICE_PREFIX.length);
  const splitAt = raw.indexOf(':');
  if (splitAt <= 0) return null;
  return {
    agentId: decodeURIComponent(raw.slice(0, splitAt)),
    deviceSerial: decodeURIComponent(raw.slice(splitAt + 1)),
  };
}

function isOnline(agent: RegisteredAgent) {
  return Date.now() - agent.lastSeenAt <= AGENT_TTL_MS;
}

export function registerRemoteAgent(input: {
  agentId: string;
  agentName?: string;
  version?: string;
  token?: string;
  devices?: RemoteAgentDevice[];
}) {
  validateToken(input.token);
  const agentId = input.agentId.trim();
  if (!agentId) throw new Error('agentId 不能为空');
  agents.set(agentId, {
    id: agentId,
    name: input.agentName?.trim() || agentId,
    version: input.version || '',
    devices: input.devices || [],
    lastSeenAt: Date.now(),
  });
}

export function listRemoteAndroidDevices(): RemoteAndroidDevice[] {
  return [...agents.values()]
    .filter(isOnline)
    .flatMap((agent) => agent.devices.map((device) => ({
      id: makeRemoteDeviceId(agent.id, device.id),
      status: device.status,
      description: [agent.name, device.model, device.description || device.status].filter(Boolean).join(' · '),
      source: 'remote' as const,
      agentId: agent.id,
      deviceSerial: device.id,
    })));
}

export function pollRemoteCommand(input: { agentId: string; token?: string }) {
  validateToken(input.token);
  const queue = queues.get(input.agentId) || [];
  return queue.shift() || null;
}

export function completeRemoteCommand(input: {
  agentId: string;
  token?: string;
} & RemoteCommandResult) {
  validateToken(input.token);
  const command = pending.get(input.commandId);
  if (!command) return;
  pending.delete(input.commandId);
  clearTimeout(command.timer);
  if (input.ok) {
    command.resolve(input.data);
  } else {
    command.reject(new Error(input.error || '远程设备命令失败'));
  }
}

export function sendRemoteCommand(deviceId: string, type: RemoteCommandType, payload?: Record<string, unknown>) {
  const parsed = parseRemoteDeviceId(deviceId);
  if (!parsed) throw new Error('远程设备 ID 无效');
  const agent = agents.get(parsed.agentId);
  if (!agent || !isOnline(agent)) throw new Error('远程设备代理已离线');
  const commandId = `remote_cmd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const command: RemoteCommand = {
    id: commandId,
    type,
    deviceId: parsed.deviceSerial,
    payload,
  };

  return new Promise<unknown>((resolve, reject) => {
    const timeoutMs = type === 'replay' ? REPLAY_COMMAND_TIMEOUT_MS : COMMAND_TIMEOUT_MS;
    const timer = setTimeout(() => {
      pending.delete(commandId);
      const queue = queues.get(parsed.agentId) || [];
      queues.set(parsed.agentId, queue.filter((item) => item.id !== commandId));
      reject(new Error('远程设备命令超时'));
    }, timeoutMs);
    pending.set(commandId, { ...command, resolve, reject, timer });
    const queue = queues.get(parsed.agentId) || [];
    queue.push(command);
    queues.set(parsed.agentId, queue);
  });
}
