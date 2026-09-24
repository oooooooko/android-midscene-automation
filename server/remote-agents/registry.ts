import type { RemoteAgentDevice, RemoteAndroidDevice, RemoteCommand, RemoteCommandResult, RemoteCommandType } from './protocol';

const REMOTE_DEVICE_PREFIX = 'remote:';
const AGENT_TTL_MS = 15_000;
const COMMAND_TIMEOUT_MS = 15_000;
// 回放由代理心跳续期，运行时长不受固定十分钟限制。
const REPLAY_COMMAND_TIMEOUT_MS = 45_000;
const LATE_RESULT_TTL_MS = 24 * 60 * 60_000;

type RegisteredAgent = {
  id: string;
  name: string;
  version: string;
  devices: RemoteAgentDevice[];
  lastSeenAt: number;
};

type PendingCommand = RemoteCommand & {
  agentId: string;
  delivered: boolean;
  cancelRequested: boolean;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

const agents = new Map<string, RegisteredAgent>();
const queues = new Map<string, RemoteCommand[]>();
const pending = new Map<string, PendingCommand>();
// ponytail: 当前进程保留离线回放身份 24 小时；跨服务重启补交需要持久化任务表。
const lateReplays = new Map<string, { command: RemoteCommand; agentId: string; expiresAt: number }>();
function pruneLateReplays() {
  for (const [id, receipt] of lateReplays) if (receipt.expiresAt <= Date.now()) lateReplays.delete(id);
}

export function stopRemoteReplay(deviceId: string) {
  const target = parseRemoteDeviceId(deviceId);
  if (!target) return false;
  let stopped = false;
  for (const command of pending.values()) {
    if (command.type === 'replay' && command.agentId === target.agentId && command.deviceId === target.deviceSerial) {
      command.cancelRequested = true;
      stopped = true;
    }
  }
  return stopped;
}

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
  pruneLateReplays();
  const cancelledCommandIds: string[] = [];
  for (const command of pending.values()) {
    if (command.agentId !== agentId || command.type !== 'replay') continue;
    command.timer.refresh();
    if (command.cancelRequested) cancelledCommandIds.push(command.id);
  }
  for (const receipt of lateReplays.values()) {
    if (receipt.agentId === agentId) cancelledCommandIds.push(receipt.command.id);
  }
  return { cancelledCommandIds };
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
  const command = queue.shift();
  if (!command) return null;
  const task = pending.get(command.id);
  if (!task) return null;
  task.delivered = true;
  return { ...command, cancelled: task.cancelRequested };
}

export function completeRemoteCommand(input: {
  agentId: string;
  token?: string;
} & RemoteCommandResult, saveResult?: (command: RemoteCommand) => void) {
  validateToken(input.token);
  pruneLateReplays();
  const command = pending.get(input.commandId);
  const late = lateReplays.get(input.commandId);
  if (!command && !late) return;
  if ((command?.agentId ?? late?.agentId) !== input.agentId) throw new Error('远程命令不属于当前代理');
  // 先落库再确认；保存失败时保留任务身份，让代理重试上报。
  if (input.ok) saveResult?.(command ?? late!.command);
  lateReplays.delete(input.commandId);
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
  if (type === 'replay' && [...pending.values()].some(command =>
    command.type === 'replay' && command.agentId === parsed.agentId && command.deviceId === parsed.deviceSerial)) {
    throw new Error('该设备已有回放任务正在执行');
  }
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
      const task = pending.get(commandId);
      pending.delete(commandId);
      if (type === 'replay' && task?.delivered) {
        pruneLateReplays();
        lateReplays.set(commandId, { command, agentId: parsed.agentId, expiresAt: Date.now() + LATE_RESULT_TTL_MS });
      }
      const queue = queues.get(parsed.agentId) || [];
      queues.set(parsed.agentId, queue.filter((item) => item.id !== commandId));
      reject(new Error(type === 'replay' ? '远程代理心跳超时，恢复连接后将终止任务并补交结果' : '远程设备命令超时'));
    }, timeoutMs);
    pending.set(commandId, { ...command, agentId: parsed.agentId, delivered: false, cancelRequested: false, resolve, reject, timer });
    const queue = queues.get(parsed.agentId) || [];
    queue.push(command);
    queues.set(parsed.agentId, queue);
  });
}
