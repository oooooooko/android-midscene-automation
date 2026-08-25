import type { IncomingMessage, ServerResponse } from 'node:http';
import { completeRemoteCommand, listRemoteAndroidDevices, pollRemoteCommand, registerRemoteAgent } from './registry';
import type { RemoteAgentDevice } from './protocol';

function sendJson(res: ServerResponse, payload: unknown, statusCode = 200) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

async function readBody<T>(req: IncomingMessage) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  return await new Promise<T>((resolve) => {
    req.on('end', () => {
      resolve(JSON.parse(body || '{}') as T);
    });
  });
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
      registerRemoteAgent({
        agentId: parsed.agentId || '',
        agentName: parsed.agentName,
        version: parsed.version,
        token: parsed.token,
        devices: parsed.devices || [],
      });
      sendJson(res, { success: true });
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
      });
      sendJson(res, { success: true });
      return true;
    }

    sendJson(res, { message: 'Remote Agent 接口不存在' }, 404);
    return true;
  } catch (error) {
    sendJson(res, { message: error instanceof Error ? error.message : 'Remote Agent 请求失败' }, 500);
    return true;
  }
}
