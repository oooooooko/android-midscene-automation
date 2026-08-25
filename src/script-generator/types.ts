export type StepType =
  | 'comment'
  | 'waitFor'
  | 'act'
  | 'tap'
  | 'input'
  | 'query'
  | 'boolean'
  | 'string'
  | 'number';

export interface ScriptStep {
  id: string;
  type: StepType;
  label: string;
  prompt: string;
  outputVar?: string;
  value?: string;
  observePrompt?: string;
  repeat?: number;
  enabled: boolean;
}

export interface ScriptForm {
  promptTitle: string;
  testName: string;
}
