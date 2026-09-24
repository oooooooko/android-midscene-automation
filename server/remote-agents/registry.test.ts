import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerRemoteAgent, makeRemoteDeviceId, sendRemoteCommand, pollRemoteCommand, completeRemoteCommand, stopRemoteReplay } from './registry';

test('replay heartbeat renews beyond ten minutes, cancellation survives dispatch, late results save once', async () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const originalNow = Date.now;
  const token = process.env.REMOTE_AGENT_TOKEN;
  let now = originalNow();
  const timers = new Set<{ at: number; callback: () => void; refresh: () => void }>();
  const advance = (ms: number) => {
    now += ms;
    for (const timer of [...timers]) if (timer.at <= now) { timers.delete(timer); timer.callback(); }
  };
  try {
    Date.now = () => now;
    globalThis.setTimeout = ((callback: () => void, ms: number) => {
      const timer = { at: now + ms, callback, refresh: () => { timer.at = now + ms; } };
      timers.add(timer); return timer;
    }) as unknown as typeof setTimeout;
    globalThis.clearTimeout = ((timer: any) => { timers.delete(timer); }) as typeof clearTimeout;
    const agentId = 'test-lease-agent';
    const heartbeat = () => registerRemoteAgent({ agentId, token, devices: [{ id: 'device', status: 'device' }] });
    const device = makeRemoteDeviceId(agentId, 'device');
    heartbeat();
    const result = sendRemoteCommand(device, 'replay', { script: { id: 'script' } });
    let completed = false;
    void result.then(() => { completed = true; });
    const command = pollRemoteCommand({ agentId, token })!;
    assert.throws(() => sendRemoteCommand(device, 'replay'), /已有回放任务/);
    for (let i = 0; i < 70; i++) { advance(10000); heartbeat(); }
    assert.equal(completed, false, 'healthy replay remains pending after 11 minutes');
    assert.equal(stopRemoteReplay(device), true);
    assert.deepEqual(heartbeat().cancelledCommandIds, [command.id]);
    assert.throws(() => completeRemoteCommand({ agentId: 'other', token, commandId: command.id, ok: true }), /不属于/);
    let saves = 0;
    const stopped = { stopped: true, history: { status: 'stopped' } };
    completeRemoteCommand({ agentId, token, commandId: command.id, ok: true, data: stopped }, () => { saves++; });
    assert.deepEqual(await result, stopped);
    completeRemoteCommand({ agentId, token, commandId: command.id, ok: true, data: stopped }, () => { saves++; });
    assert.equal(saves, 1, 'result retry must not duplicate history');
    assert.equal(stopRemoteReplay(device), false);

    const queuedResult = sendRemoteCommand(device, 'replay');
    assert.equal(stopRemoteReplay(device), true);
    const queued = pollRemoteCommand({ agentId, token })!;
    assert.equal(queued.cancelled, true, 'cancel before poll survives delivery');
    completeRemoteCommand({ agentId, token, commandId: queued.id, ok: true }); await queuedResult;

    const lateResult = sendRemoteCommand(device, 'replay', { script: { id: 'late-script' } });
    const rejected = assert.rejects(lateResult, /心跳超时/);
    const late = pollRemoteCommand({ agentId, token })!;
    advance(45001); await rejected;
    assert.deepEqual(heartbeat().cancelledCommandIds, [late.id], 'reconnecting agent stops expired replay');
    const input = { agentId, token, commandId: late.id, ok: true, data: { history: {} } };
    assert.throws(() => completeRemoteCommand(input, () => { throw new Error('disk busy'); }), /disk busy/);
    completeRemoteCommand(input, command => { assert.equal((command.payload?.script as { id: string }).id, 'late-script'); saves++; });
    completeRemoteCommand(input, () => { saves++; });
    assert.equal(saves, 2, 'late result is saved once even after a temporary persistence failure');
    assert.deepEqual(heartbeat().cancelledCommandIds, []);
  } finally {
    globalThis.setTimeout = originalSetTimeout; globalThis.clearTimeout = originalClearTimeout; Date.now = originalNow;
  }
});
