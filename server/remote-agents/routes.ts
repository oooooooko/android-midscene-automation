import { saveRunHistory } from '../appium-recorder/run-history';
import type { RunDetail } from '../../src/appium-recorder/run-history';
import { readBody, requestErrorStatus } from '../request-body';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { completeRemoteCommand, makeRemoteDeviceId, listRemoteAndroidDevices, pollRemoteCommand, registerRemoteAgent } from './registry';
import type { RemoteAgentDevice } from './protocol';

function sendJson(res: ServerResponse, payload: unknown, statusCode = 200) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}


export async function handleRemoteAgentRequest(req: IncomingMessage, res: ServerResponse) {
  const requestUrl = new URL(req.url || '/', 'http://localhost');
  const pathname = requestUrl.pathname;
  if (!pathname.startsWith('/api/remote-agents')) return false;

  try {
    if (pathname === '/api/remote-agents' && req.method === 'GET') {
      sendJson(res, { devices: listRemoteAndroidDevices() });
      return true;
    }

    if (pathname === '/api/remote-agents/heartbeat' && req.method === 'POST') {
      const parsed = await readBody<{
        agentId?: string;
        agentName?: string;
        version?: string;
        token?: string;
        devices?: RemoteAgentDevice[];
      }>(req);
      const control = registerRemoteAgent({
        agentId: parsed.agentId || '',
        agentName: parsed.agentName,
        version: parsed.version,
        token: parsed.token,
        devices: parsed.devices || [],
      });
      sendJson(res, { success: true, ...control });
      return true;
    }

    if (pathname === '/api/remote-agents/poll' && req.method === 'GET') {
      const command = pollRemoteCommand({
        agentId: requestUrl.searchParams.get('agentId') || '',
        token: requestUrl.searchParams.get('token') || '',
      });
      sendJson(res, { command });
      return true;
    }

    if (pathname === '/api/remote-agents/result' && req.method === 'POST') {
      const parsed = await readBody<{
        agentId?: string;
        token?: string;
        commandId?: string;
        ok?: boolean;
        data?: unknown;
        error?: string;
      }>(req);
      completeRemoteCommand({
        agentId: parsed.agentId || '',
        token: parsed.token,
        commandId: parsed.commandId || '',
        ok: parsed.ok === true,
        data: parsed.data,
        error: parsed.error,
      }, command => {
        const result = parsed.data as { history?: RunDetail } | undefined;
        if (command.type !== 'replay' || !result?.history) return;
        const script = command.payload?.script as { id: string };
        saveRunHistory({ ...result.history, scriptId: script.id, deviceId: makeRemoteDeviceId(parsed.agentId!, command.deviceId) });
      });
      sendJson(res, { success: true });
      return true;
    }

    sendJson(res, { message: 'Remote Agent 接口不存在' }, 404);
    return true;
  } catch (error) {
    sendJson(res, { message: error instanceof Error ? error.message : 'Remote Agent 请求失败' }, requestErrorStatus(error));
    return true;
  }
}
