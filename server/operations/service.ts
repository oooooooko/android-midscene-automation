import {
  appendOperationEventRecord,
  createOperationRecord,
  finishOperationRecord,
  getOperationRecord,
  listOperationEventRecords,
  listOperationRecords,
} from './repository';
import type { OperationStatus } from './types';

// 创建脚本执行记录；后续日志、步骤事件、最终结果都挂在这个 operation 下。
export function startScriptRunOperation(input: {
  scriptName: string;
  deviceId: string;
  sessionId: string;
  request: Record<string, unknown>;
}) {
  const operation = createOperationRecord(input);
  if (!operation) {
    throw new Error('创建执行记录失败');
  }
  appendOperationEventRecord({
    operationId: operation.id,
    eventType: 'operation_start',
    message: `开始执行脚本：${input.scriptName}`,
    data: {
      scriptName: input.scriptName,
      deviceId: input.deviceId,
      sessionId: input.sessionId,
    },
  });
  return operation;
}

export function recordOperationEvent(input: {
  operationId: string;
  eventType: string;
  message?: string;
  data?: Record<string, unknown>;
}) {
  appendOperationEventRecord(input);
}

export function finishScriptRunOperation(input: {
  operationId: string;
  status: OperationStatus;
  result?: Record<string, unknown>;
  output?: string;
  filePath?: string;
  errorMessage?: string;
}) {
  recordOperationEvent({
    operationId: input.operationId,
    eventType: 'operation_finish',
    message: input.errorMessage || `执行结束：${input.status}`,
    data: {
      status: input.status,
      filePath: input.filePath,
    },
  });
  return finishOperationRecord({
    id: input.operationId,
    status: input.status,
    result: input.result || null,
    output: input.output || '',
    filePath: input.filePath || '',
    errorMessage: input.errorMessage || '',
  });
}

export function listOperations(limit?: number) {
  return listOperationRecords(limit);
}

export function getOperationWithEvents(operationId: string) {
  const operation = getOperationRecord(operationId);
  if (!operation) {
    return null;
  }
  return {
    operation,
    events: listOperationEventRecords(operationId),
  };
}
