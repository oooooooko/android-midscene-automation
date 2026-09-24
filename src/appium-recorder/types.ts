import type { AiInvalidResultBranch, AiObservationConfig } from './ai-recognition';
import type { TestVariable, VariableExtraction, ScriptReturn } from './variables';
import type { ImageCheckConfig } from './image-check';

export type AppiumBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
};

export type AppiumSelector = {
  strategy: 'accessibilityId' | 'id' | 'androidUiAutomator' | 'xpath' | 'bounds';
  value?: string;
  centerX?: number;
  centerY?: number;
  unique?: boolean;
  matchCount?: number;
  source?: 'node' | 'ancestor' | 'fallback';
};

export type AppiumPageSnapshot = {
  activity?: string;
  packageName?: string;
  treeSignature?: string;
  selectedNodePath?: string;
};

export type AppiumVisualChangeRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AppiumVisualChangeConfig = {
  mode: 'selectedElement' | 'region';
  region: AppiumVisualChangeRegion;
  role?: 'start' | 'end';
  pairId?: string;
  pairLabel?: string;
  startStepId?: string;
  endStepId?: string;
  durationMs: number;
  intervalMs: number;
  changeRatioThreshold: number;
  pixelmatchThreshold: number;
};

export type AppiumNode = {
  id: string;
  label: string;
  resourceId: string;
  text: string;
  contentDesc: string;
  className: string;
  packageName: string;
  clickable: boolean;
  enabled: boolean;
  checkable?: boolean;
  checked?: boolean;
  xpath: string;
  bounds?: AppiumBounds;
  selector: AppiumSelector;
  contextSelector?: AppiumSelector;
  children: AppiumNode[];
};

export type AppiumRecordedStep = {
  mergeUndo?: BranchMergeUndo;
  id: string;
  type:
    | 'tap'
    | 'input'
    | 'tapIfExists'
    | 'inputIfExists'
    | 'clearIfExists'
    | 'backIfExists'
    | 'waitFor'
    | 'assertExists'
    | 'checkboxState'
    | 'checkedState'
    | 'radioButtonState'
    | 'aiRecognition'
    | 'imageCheck'
    | 'textClick'
    | 'key'
    | 'waitActivity'
    | 'delay'
    | 'clearInput'
    | 'coordinateTap'
    | 'swipe'
    | 'screenshot'
    | 'launchApp'
    | 'stopApp'
    | 'openGallery'
    | 'endFlow'
    | 'loop'
    | 'breakLoop'
    | 'continueLoop'
    | 'clearAppData'
    | 'waitDisappear'
    | 'assertText'
    | 'longPress'
    | 'pinch'
    | 'runScript'
    | 'noop'
    | 'extractVariable'
    | 'log'
    | 'visualChange';
  label: string;
  note?: string;
  selector?: AppiumSelector;
  contextSelector?: AppiumSelector;
  selectorChain?: AppiumSelector[];
  fallback?: AppiumSelector;
  value?: string;
  logPrefix?: string;
  extractVariable?: VariableExtraction;
  parameters?: TestVariable[];
  returns?: ScriptReturn[];
  keyCode?: number;
  timeoutMs?: number;
  aiTimeoutEnabled?: boolean;
  aiBranchEnabled?: boolean;
  aiInvalidResultBranch?: AiInvalidResultBranch;
  aiObservation?: AiObservationConfig;
  timeoutBranch?: 'stop' | 'yes' | 'no';
  longPressMode?: 'element' | 'coordinates';
  breakLoopTargetId?: string;
  continueLoopTargetId?: string;
  loop?: {
    maxIterations: number;
    exitWhen: 'never' | 'exists' | 'notExists';
  };
  flow?: {
    nodeKind?: 'action' | 'condition' | 'assertion';
    yesTargetId?: string;
    noTargetId?: string;
    parentConditionId?: string;
    parentBranch?: 'yes' | 'no';
    successTargetId?: string;
    failureTargetId?: string;
    textMatch?: 'contains' | 'exact';
    collapsed?: boolean;
  };
  pageBefore?: AppiumPageSnapshot;
  pageAfter?: AppiumPageSnapshot;
  swipe?: {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    duration: number;
  };
  pinch?: {
    direction: 'in' | 'out';
    centerX: number;
    centerY: number;
    percent: number;
  };
  visualChange?: AppiumVisualChangeConfig;
  imageCheck?: ImageCheckConfig;
  snapshot?: {
    text: string;
    resourceId: string;
    contentDesc: string;
    className: string;
  };
};

export type BranchMergeUndo = {
  version: 1;
  conditionId: string;
  source: 'yes' | 'no';
  commonIds: string[];
  originalIds: string[];
  boundaryId?: string;
  flows: { id: string; before: AppiumRecordedStep['flow']; after: AppiumRecordedStep['flow'] }[];
  removed: AppiumRecordedStep[];
};

export type AppiumRecordedScript = {
  id: string;
  name: string;
  appPackage: string;
  appActivity: string;
  deviceId: string;
  variables?: TestVariable[];
  steps: AppiumRecordedStep[];
  createdAt: string;
  updatedAt: string;
};
