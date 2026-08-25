export type OperationStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

export type OperationRecord = {
  id: string;
  kind: 'script_run';
  status: OperationStatus;
  scriptName: string;
  deviceId: string;
  sessionId: string;
  request: Record<string, unknown>;
  result: Record<string, unknown> | null;
  output: string;
  filePath: string;
  errorMessage: string;
  createdAt: string;
  startedAt: string;
  finishedAt: string;
};

export type OperationEventRecord = {
  seq: number;
  operationId: string;
  timestamp: string;
  eventType: string;
  message: string;
  data: Record<string, unknown>;
};
