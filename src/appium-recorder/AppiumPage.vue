<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, provide, reactive, shallowRef, watch } from 'vue';
import { flowBackgroundKey, normalizeFlowBackground, flowLineColorKey, normalizeFlowLineColor } from './flow-appearance';
import { useCoordinatePicker } from './coordinate-preview';
import { DEFAULT_NODE_TIMEOUT_MS } from './node-timeout';
import { aiPromptPresetsKey, DEFAULT_AI_PROMPT_PRESETS, type AiPromptPreset } from './ai-prompt-presets';
import AiRecognitionPromptInput from './components/AiRecognitionPromptInput.vue';
import { ElForm, ElFormItem, ElInputNumber, ElMessage, ElMessageBox, ElOption, ElSelect } from 'element-plus';
import { ArrowDown, Check, CircleClose, CopyDocument, Delete, Document, Download, Edit, Plus, Refresh, Upload, VideoPlay, View, Clock } from '@element-plus/icons-vue';
import RunHistoryDialog from './RunHistoryDialog.vue';
import type { AndroidDevice, AppPreset, DeviceAction } from '../types';
import DevicePreviewPanel from '../components/device/DevicePreviewPanel.vue';
import LoopSettings from './components/LoopSettings.vue';
import BreakLoopSettings from './components/BreakLoopSettings.vue';
import VisualChangeEndPicker from './components/VisualChangeEndPicker.vue';
import PresetVariables from './components/PresetVariables.vue';
import { insertBeforeSharedStep } from './flow-insert';
import VariableExtractionSettings from './components/VariableExtractionSettings.vue';
import ScriptParameterSettings from './components/ScriptParameterSettings.vue';
import { validateVariables, validateExtraction, validateReturns, type TestVariable } from './variables';
import { breakLoopTarget, continueLoopTarget, defaultLoopConfig, enclosingLoops, validateLoop, validateLoopSteps } from './bounded-loop';
import {
  clearAppiumDeviceAppData,
  checkReportSummaryModel,
  deleteAppiumScript,
  downloadAppiumScript,
  getAppiumScripts,
  getAppiumTree,
  importAppiumScript,
  launchAppiumDeviceApp,
  replayAppiumScript,
  saveAppiumScript,
  saveVariables,
  stopAppiumReplay,
  tapAppiumDevice,
} from './api';
import ComponentInspector from './components/ComponentInspector.vue';
import RecorderWorkspace from './components/RecorderWorkspace.vue';
import FlowCanvas from './components/FlowCanvas.vue';
import LongPressSettings from './components/LongPressSettings.vue';
import StageLogSettings from './components/StageLogSettings.vue';
import TextClickSettings from './components/TextClickSettings.vue';
import { textClickSelector } from './text-click';
import { DEFAULT_LOG_PREFIX, validateStageLog } from './stage-log';
import RecordedSteps from './components/RecordedSteps.vue';
import NewScriptDialog from './components/NewScriptDialog.vue';
import VisualChangeDialog from './components/VisualChangeDialog.vue';
import ImageCheckDialog from './components/ImageCheckDialog.vue';
import AiRecognitionTestDialog from './components/AiRecognitionTestDialog.vue';
import { validateAiRecognitionPrompt } from './ai-recognition';
import { DEFAULT_REPORT_SUMMARY_PROMPT, REPORT_SUMMARY_PROMPT_PRESETS, type ReportSummaryConfig } from './report-summary';
import { createImageCheckConfig, validateImageCheck, type ImageCheckConfig } from './image-check';
import {
  createFlowClipboard,
  pasteFlowClipboard,
  type FlowClipboard,
} from './flow-copy';
import { labelFlowStep } from './flow-labels';
import { validateLongPress } from './long-press';
import { nativeControlName, matchesNativeControl } from './native-control-state';
import { normalizeLegacyNestedConditionBranches } from './flow-normalize';
import { removeFlowStep } from './flow-remove';
import type { FlowActionGroup, InsertAction } from './flow-graph';
import { findSmallestNodeAtPoint, flattenNodes, parseWindowHierarchy } from './tree';
import {
  boundsToVisualRegion,
  createStepId,
  normalizeVisualChangeConfig,
  syncVisualChangeThreshold,
  visualRegionToBounds,
} from './visual-change';
import {
  findOpenVisualChangeStarts,
  nextVisualChangePairLabel,
} from './visual-change-pairs';
import type {
  AppiumNode,
  AppiumRecordedScript,
  AppiumRecordedStep,
  AppiumVisualChangeConfig,
  AppiumVisualChangeRegion,
} from './types';

type NodeStepType = 'tap' | 'input' | 'waitFor';
type BranchName = 'yes' | 'no';
type LegacyFlow = NonNullable<AppiumRecordedStep['flow']> & { scope?: string };
type SwipeGesture = NonNullable<AppiumRecordedStep['swipe']>;
type SwipeForm = SwipeGesture & { direction: string };
type BranchTarget = {
  beforeStepId?: string;
  stepId: string;
  branch: BranchName;
  updateTarget?: boolean;
  entryTargetId?: string;
  nextTargetId?: string;
};
type RecorderAction = InsertAction;

const WORKBENCH_TAB_STORAGE_KEY = 'android-midscene-automation:appium-workbench-tab';
const workspaceRef = shallowRef<InstanceType<typeof RecorderWorkspace>>();
const historyScript = shallowRef<{ id: string; name: string } | null>(null);
const AUTO_TREE_REFRESH_INTERVAL_MS = 1800;

const readonlyFlowActionGroups: FlowActionGroup[] = [];
const readonlyFlowSelectedIndexes: number[] = [];
const recordReplayVideo = shallowRef(false);
const selectedReportTemplateName = shallowRef('');

const props = defineProps<{
  aiRecognitionModelConfigured?: boolean;
  aiPromptPresets?: AiPromptPreset[];
  reportSummary?: ReportSummaryConfig;
  flowBackgroundColor?: string;
  flowLineColor?: string;
  active: boolean;
  appPresets: AppPreset[];
  deviceActions: readonly DeviceAction[];
  playgroundAvailable: boolean;
  playgroundDeviceId: string;
  playgroundFrameUrl: string;
  playgroundPreviewError: string;
  devicePreviewUrl: string;
  androidDevices: AndroidDevice[];
  deviceWidth: number;
  deviceHeight: number;
  switchAndroidDevice: (deviceId: string) => Promise<void>;
  triggerDeviceKey: (keyCode: number) => Promise<void>;
  refreshDevicePreview: () => void | Promise<void>;
  swipeDevice: (
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    duration?: number,
  ) => Promise<void>;
}>();

// provide/inject 随组件关系传递，放大弹窗 teleport 后也能使用同一颜色。
provide(flowBackgroundKey, computed(() => normalizeFlowBackground(props.flowBackgroundColor)));
provide(flowLineColorKey, computed(() => normalizeFlowLineColor(props.flowLineColor)));
const availableAiPromptPresets = computed(() => props.aiPromptPresets ?? DEFAULT_AI_PROMPT_PRESETS);
const availableReportTemplates = computed(() => [
  ...REPORT_SUMMARY_PROMPT_PRESETS,
  ...(props.reportSummary?.customPresets || []),
]);
const selectedReportTemplate = computed(() => availableReportTemplates.value.find(item => item.name === selectedReportTemplateName.value));
provide(aiPromptPresetsKey, availableAiPromptPresets);
const selectedDeviceId = computed(() => props.playgroundDeviceId);
const tree = shallowRef<AppiumNode | null>(null);
const selectedNode = shallowRef<AppiumNode | null>(null);
const scripts = shallowRef<AppiumRecordedScript[]>([]);
const selectedScriptId = shallowRef('');
const newScriptDialogVisible = shallowRef(false);
const newScriptRevision = shallowRef(0);
const storedWorkbenchTab = window.localStorage.getItem(WORKBENCH_TAB_STORAGE_KEY);
const activeWorkbenchTab = shallowRef<'recording' | 'scripts' | 'variables'>(storedWorkbenchTab === 'scripts' ? 'scripts' : storedWorkbenchTab === 'variables' ? 'variables' : 'recording');
const steps = shallowRef<AppiumRecordedStep[]>([]);
const aiRecognitionTestStep = shallowRef<AppiumRecordedStep | null>(null);
const flowClipboard = shallowRef<FlowClipboard | null>(null);
const rawXml = shallowRef('');
const currentActivity = shallowRef('');
const replayOutput = shallowRef('');
const replayOutputDialogVisible = shallowRef(false);
const linkedScriptDialogVisible = shallowRef(false);
const linkedScriptEditingId = shallowRef('');
const linkedScriptTargetId = shallowRef('');
const linkedParameters = reactive<AppiumRecordedStep>({ id: 'link-parameters', type: 'runScript', label: '', parameters: [], returns: [] });
const linkedScriptInsertIndex = shallowRef<number | undefined>();
const linkedScriptBranchTarget = shallowRef<BranchTarget | null>(null);
const linkedScriptExpectedActivity = shallowRef('');
const linkedScriptPreviewVisible = shallowRef(false);
const linkedScriptPreviewScriptId = shallowRef('');
const linkedScriptPreviewResetToken = shallowRef(0);
const visualChangeDialogVisible = shallowRef(false);
const imageCheckDraft = shallowRef<AppiumRecordedStep | null>(null);
let imageCheckIndex: number | undefined;
let imageCheckBranch: BranchTarget | undefined;
let imageCheckEditing = false;
const imageCheckPicking = shallowRef(false);
const visualChangePicking = shallowRef(false);
const visualChangeInsertIndex = shallowRef<number | undefined>();
const visualChangeBranchTarget = shallowRef<BranchTarget | null>(null);
const visualChangeConfig = shallowRef<AppiumVisualChangeConfig>(normalizeVisualChangeConfig());
const loadingTree = shallowRef(false);
const saving = shallowRef(false);
const importingScript = shallowRef(false);
const scriptImportInput = shallowRef<HTMLInputElement | null>(null);
const deletingScriptId = shallowRef('');
const duplicatingScriptId = shallowRef('');
const renamingScriptId = shallowRef('');
const downloadingScriptId = shallowRef('');
const replaying = shallowRef(false);
const preparingReplay = shallowRef(false);
const stoppingReplay = shallowRef(false);
const activeReplayDeviceId = shallowRef('');
const recordingTap = shallowRef(false);
const resolvingNavigation = shallowRef(false);
const launchingApp = shallowRef(false);
const executingAppStepId = shallowRef('');
const pendingNavigation = shallowRef<{
  beforeActivity: string;
  afterActivity: string;
} | null>(null);
type TreePayload = Awaited<ReturnType<typeof getAppiumTree>>;
let treeRequest: Promise<TreePayload> | null = null;
let autoTreeRefreshTimer: number | null = null;
let autoTreeRefreshInFlight = false;

const form = reactive({
  name: '',
  appPackage: '',
  appActivity: '',
});
const scriptVariables = shallowRef<TestVariable[]>([]);

const savedDraftSnapshot = shallowRef('');
const currentDraftSnapshot = computed(() => JSON.stringify({
  name: form.name,
  appPackage: form.appPackage,
  appActivity: form.appActivity,
  steps: steps.value,
  variables: scriptVariables.value,
}));
const flowClipboardCount = computed(() => flowClipboard.value?.steps.length || 0);
const hasUnsavedChanges = computed(() => currentDraftSnapshot.value !== savedDraftSnapshot.value);

function markDraftSaved() {
  savedDraftSnapshot.value = currentDraftSnapshot.value;
}

function onVariablesSaved(id: string, variables: TestVariable[]) {
  const script = scripts.value.find(item => item.id === id);
  if (script) script.variables = variables;
  if (id && selectedScriptId.value === id) {
    // 仅更新变量的已保存基线，不把尚未保存的节点标记为已保存。
    const snapshot = JSON.parse(savedDraftSnapshot.value);
    savedDraftSnapshot.value = JSON.stringify({ ...snapshot, variables });
  }
}

function warnBeforeUnload(event: BeforeUnloadEvent) {
  if (!hasUnsavedChanges.value) return;
  event.preventDefault();
  event.returnValue = '';
}

markDraftSaved();

const selectedScript = computed(() => scripts.value.find((script) => script.id === selectedScriptId.value) || null);
const linkableScripts = computed(() => scripts.value.filter((script) => script.id !== selectedScriptId.value));
const linkedScriptTarget = computed(() => scripts.value.find((script) => script.id === linkedScriptTargetId.value) || null);
const linkedScriptPreviewScript = computed(() => (
  scripts.value.find((script) => script.id === linkedScriptPreviewScriptId.value) || null
));
const compatibleLinkableScripts = computed(() => linkableScripts.value.filter(
  (script) => script.appPackage === form.appPackage,
));
const hasSelectedAppPackage = computed(() => props.appPresets.some((app) => app.packageName === form.appPackage));
const scriptActivityMismatch = computed(() => {
  const expectedActivity = selectedScript.value?.appActivity?.trim();
  if (!expectedActivity) return false;
  return currentActivity.value !== expectedActivity;
});
const recordingBusy = computed(() => (
  recordingTap.value
  || resolvingNavigation.value
  || Boolean(pendingNavigation.value)
));
const recordingLocked = computed(() => recordingBusy.value || replaying.value || preparingReplay.value);
const newScriptDisabled = computed(() => saving.value || replaying.value || preparingReplay.value || recordingBusy.value || launchingApp.value || importingScript.value);
const overlayBounds = computed(() => flattenNodes(tree.value).flatMap((node) => (
  node.bounds ? [{ id: node.id, ...node.bounds }] : []
)));
const selectedBounds = computed(() => {
  const bounds = selectedNode.value?.bounds;
  return bounds && selectedNode.value ? { id: selectedNode.value.id, ...bounds } : undefined;
});
const visualChangeSelectedRegion = computed(() => {
  if (imageCheckDraft.value?.imageCheck?.target === 'region') return visualRegionToBounds('image-check-region', imageCheckDraft.value.imageCheck.region);
  if (!visualChangeDialogVisible.value || visualChangeConfig.value.mode !== 'region') return undefined;
  return visualRegionToBounds('visual-change-region', visualChangeConfig.value.region);
});
const visualChangeRegionSelectionEnabled = computed(() => (
  (visualChangeDialogVisible.value && visualChangeConfig.value.mode === 'region') || imageCheckDraft.value?.imageCheck?.target === 'region'
));

const coordinatePicker = useCoordinatePicker(
  computed(() => Boolean(selectedDeviceId.value) && !recordingLocked.value && !visualChangeRegionSelectionEnabled.value),
  () => workspaceRef.value?.showPreview(),
);
const pickingCoordinate = coordinatePicker.picking;
watch([selectedDeviceId, () => props.active], () => coordinatePicker.cancel());

function stepWithBranchTarget(step: AppiumRecordedStep, branchTarget: BranchTarget) {
  return {
    ...step,
    flow: {
      ...(step.flow || {}),
      parentConditionId: branchTarget.stepId,
      parentBranch: branchTarget.branch,
      ...(branchTarget.nextTargetId ? { successTargetId: branchTarget.nextTargetId } : {}),
    },
  };
}

function insertStep(step: AppiumRecordedStep, index?: number, branchTarget?: BranchTarget) {
  if (branchTarget?.beforeStepId) {
    steps.value = insertBeforeSharedStep(steps.value, branchTarget.beforeStepId, [step], [step.id]);
    return steps.value.find(item => item.id === step.id)!;
  }
  let nextSteps = [...steps.value];
  let insertedStep = branchTarget ? stepWithBranchTarget(step, branchTarget) : step;
  if (index === -1) {
    nextSteps.unshift(insertedStep);
  } else if (typeof index === 'number') {
    const previousStep = nextSteps[index];
    const previousTargetId = previousStep?.flow?.successTargetId;
    const shouldRewireSuccess = previousStep
      && previousTargetId
      && !(branchTarget && previousStep.id === branchTarget.stepId);
    if (shouldRewireSuccess) {
      insertedStep = {
        ...insertedStep,
        flow: {
          ...(insertedStep.flow || {}),
          successTargetId: previousTargetId,
        },
      };
      nextSteps[index] = {
        ...previousStep,
        flow: {
          ...(previousStep.flow || {}),
          successTargetId: insertedStep.id,
        },
      };
    }
    nextSteps.splice(index + 1, 0, insertedStep);
  } else {
    nextSteps.push(insertedStep);
  }
  if (branchTarget?.updateTarget) {
    const targetKey = branchTarget.branch === 'yes' ? 'yesTargetId' : 'noTargetId';
    nextSteps = nextSteps.map((item) => (
      item.id === branchTarget.stepId
        ? {
            ...item,
            flow: {
              ...(item.flow || {}),
              nodeKind: 'condition',
              [targetKey]: branchTarget.entryTargetId || insertedStep.id,
            },
          }
        : item
    ));
  }
  steps.value = nextSteps;
  return insertedStep;
}

function copyFlowNodes(indexes: number[]) {
  try {
    flowClipboard.value = createFlowClipboard(steps.value, indexes);
    ElMessage.success(`已复制 ${flowClipboardCount.value} 个节点`);
  } catch (error) {
    ElMessage.warning(error instanceof Error ? error.message : '复制节点失败');
  }
}

function pasteFlowNodes(index: number, branch?: BranchName, beforeStepId?: string) {
  if (!flowClipboard.value) {
    ElMessage.warning('请先复制节点');
    return;
  }
  if (recordingBusy.value) {
    ElMessage.warning('页面操作处理中，请稍后再粘贴');
    return;
  }
  try {
    const nextSteps = pasteFlowClipboard(steps.value, flowClipboard.value, {
      afterIndex: index,
      branch,
      beforeStepId,
    });
    validateLoopSteps(nextSteps);
    steps.value = nextSteps;
    ElMessage.success(`已粘贴 ${flowClipboardCount.value} 个节点${branch ? `到${branch === 'yes' ? '是' : '否'}分支` : ''}`);
    flowClipboard.value = null;
  } catch (error) {
    ElMessage.warning(error instanceof Error ? error.message : '粘贴节点失败');
  }
}

function normalizeLegacyFlowScope(step: AppiumRecordedStep): AppiumRecordedStep {
  const flow = step.flow as LegacyFlow | undefined;
  if (!flow?.scope) return step;
  const nextFlow = { ...flow };
  delete nextFlow.scope;
  return {
    ...step,
    flow: Object.keys(nextFlow).length ? nextFlow : undefined,
  };
}

function updateBranchTarget(stepId: string, branch: BranchName, targetId: string) {
  const targetKey = branch === 'yes' ? 'yesTargetId' : 'noTargetId';
  steps.value = steps.value.map((step) => (
    step.id === stepId
      ? {
          ...step,
          flow: {
            ...(step.flow || {}),
            nodeKind: 'condition',
            [targetKey]: targetId,
          },
        }
      : step
  ));
}

function attachStepToBranch(stepId: string, conditionId: string, branch: BranchName) {
  steps.value = steps.value.map((step) => (
    step.id === stepId
      ? {
          ...step,
          flow: {
            ...(step.flow || {}),
            parentConditionId: conditionId,
            parentBranch: branch,
          },
        }
      : step
  ));
}

function applyBranchTargetToInsertedStep(inserted: AppiumRecordedStep, branchTarget: BranchTarget) {
  attachStepToBranch(inserted.id, branchTarget.stepId, branchTarget.branch);
  if (branchTarget.nextTargetId) {
    steps.value = steps.value.map((step) => (
      step.id === inserted.id
        ? {
            ...step,
            flow: { ...(step.flow || {}), successTargetId: branchTarget.nextTargetId },
          }
        : step
    ));
  }
  if (branchTarget.updateTarget) {
    updateBranchTarget(
      branchTarget.stepId,
      branchTarget.branch,
      branchTarget.entryTargetId || inserted.id,
    );
  }
}

function branchContextForInsert(index: number, branch: BranchName) {
  const anchor = steps.value[index];
  if (!anchor) return undefined;
  if (anchor.flow?.nodeKind === 'condition') {
    return { condition: anchor, conditionIndex: index };
  }
  if (anchor.flow?.parentConditionId && anchor.flow.parentBranch === branch) {
    const conditionIndex = steps.value.findIndex((step) => step.id === anchor.flow?.parentConditionId);
    const condition = conditionIndex >= 0 ? steps.value[conditionIndex] : undefined;
    return condition ? { condition, conditionIndex } : undefined;
  }
  return undefined;
}

function nextBranchStepAfter(conditionId: string, branch: BranchName, index: number) {
  return steps.value.slice(index + 1).find((step) => (
    step.flow?.parentConditionId === conditionId && step.flow.parentBranch === branch
  ));
}

function createStep(type: NodeStepType, node: AppiumNode): AppiumRecordedStep {
  const labelMap = {
    tap: '点击',
    input: '输入',
    waitFor: '等待出现',
  };
  return {
    id: `step_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    label: `${labelMap[type]} ${node.label}`,
    selector: node.selector,
    contextSelector: node.contextSelector,
    selectorChain: node.xpath && node.selector.value !== node.xpath
      ? [{ strategy: 'xpath', value: node.xpath, unique: true, matchCount: 1 }]
      : undefined,
    fallback: node.bounds ? { strategy: 'bounds', centerX: node.bounds.centerX, centerY: node.bounds.centerY } : undefined,
    timeoutMs: type === 'waitFor' ? DEFAULT_NODE_TIMEOUT_MS : undefined,
    pageBefore: currentPageSnapshot(node),
    snapshot: {
      text: node.text,
      resourceId: node.resourceId,
      contentDesc: node.contentDesc,
      className: node.className,
    },
  };
}

async function copyReplayOutput() {
  if (!replayOutput.value) return;
  await navigator.clipboard.writeText(replayOutput.value);
  ElMessage.success('回放输出已复制');
}

function clearReplayOutput() {
  replayOutput.value = '';
  replayOutputDialogVisible.value = false;
}

function createDelayStep(timeoutMs: number): AppiumRecordedStep {
  return {
    id: `step_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'delay',
    label: `延时 ${timeoutMs}ms`,
    timeoutMs,
  };
}

function createNodeActionStep(
  type: AppiumRecordedStep['type'],
  label: string,
  node: AppiumNode,
  options: Pick<AppiumRecordedStep, 'timeoutMs' | 'value'> = {},
): AppiumRecordedStep {
  return {
    id: `step_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    label: `${label} ${node.label}`,
    selector: node.selector,
    contextSelector: node.contextSelector,
    selectorChain: node.xpath && node.selector.value !== node.xpath
      ? [{ strategy: 'xpath', value: node.xpath, unique: true, matchCount: 1 }]
      : undefined,
    fallback: node.bounds ? { strategy: 'bounds', centerX: node.bounds.centerX, centerY: node.bounds.centerY } : undefined,
    ...options,
    pageBefore: currentPageSnapshot(node),
    snapshot: {
      text: node.text,
      resourceId: node.resourceId,
      contentDesc: node.contentDesc,
      className: node.className,
    },
  };
}

function createKeyStep(keyCode: number, label = '按返回键'): AppiumRecordedStep {
  return {
    id: `step_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'key',
    label,
    keyCode,
  };
}

function swipePreset(direction: string): { direction: string; label: string; swipe: SwipeGesture } {
  const normalizedDirection = ({ 上: 'up', 下: 'down', 左: 'left', 右: 'right' } as Record<string, string>)[direction] || direction;
  const width = props.deviceWidth || 1080;
  const height = props.deviceHeight || 1920;
  const centerX = Math.round(width * 0.5);
  const centerY = Math.round(height * 0.5);
  const distanceX = Math.round(width * 0.35);
  const distanceY = Math.round(height * 0.35);
  const swipeMap: Record<string, SwipeGesture> = {
    up: { startX: centerX, startY: centerY + distanceY, endX: centerX, endY: centerY - distanceY, duration: 500 },
    down: { startX: centerX, startY: centerY - distanceY, endX: centerX, endY: centerY + distanceY, duration: 500 },
    left: { startX: centerX + distanceX, startY: centerY, endX: centerX - distanceX, endY: centerY, duration: 500 },
    right: { startX: centerX - distanceX, startY: centerY, endX: centerX + distanceX, endY: centerY, duration: 500 },
  };
  const labelMap: Record<string, string> = { up: '上滑', down: '下滑', left: '左滑', right: '右滑' };
  return {
    direction: normalizedDirection,
    label: labelMap[normalizedDirection] || '滑动',
    swipe: swipeMap[normalizedDirection] || swipeMap.up,
  };
}

function createSwipeStep(input: { label: string; swipe: SwipeGesture }): AppiumRecordedStep {
  return {
    id: `step_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'swipe',
    label: input.label,
    swipe: input.swipe,
  };
}

function createWaitActivityStep(activity: string): AppiumRecordedStep {
  return {
    id: `step_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'waitActivity',
    label: `等待 Activity ${activity}`,
    value: activity,
    timeoutMs: DEFAULT_NODE_TIMEOUT_MS,
  };
}

function createRunScriptStep(script: AppiumRecordedScript): AppiumRecordedStep {
  return {
    id: `step_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'runScript',
    label: `连接脚本 ${script.name}`,
    value: script.id,
    flow: { nodeKind: 'action' },
  };
}

function createNoopStep(): AppiumRecordedStep {
  return {
    id: createStepId(),
    type: 'noop',
    label: '空节点',
    flow: { nodeKind: 'action' },
  };
}

function defaultVisualChangeRegion(): AppiumVisualChangeRegion {
  const width = props.deviceWidth || 1080;
  const height = props.deviceHeight || 1920;
  const regionWidth = Math.max(1, Math.round(width * 0.5));
  const regionHeight = Math.max(1, Math.round(height * 0.25));
  return {
    x: Math.max(0, Math.round((width - regionWidth) / 2)),
    y: Math.max(0, Math.round((height - regionHeight) / 2)),
    width: regionWidth,
    height: regionHeight,
  };
}

function updateImageCheck(config: ImageCheckConfig) {
  if (imageCheckDraft.value) imageCheckDraft.value = { ...imageCheckDraft.value, imageCheck: config };
}

function useImageCheckElement() {
  const node = selectedNode.value;
  if (!node?.bounds || !imageCheckDraft.value?.imageCheck) return;
  const located = createNodeActionStep('imageCheck', '图像判断', node);
  imageCheckDraft.value = { ...imageCheckDraft.value, selector: located.selector, contextSelector: located.contextSelector,
    selectorChain: located.selectorChain, fallback: undefined,
    imageCheck: { ...imageCheckDraft.value.imageCheck, target: 'element', region: boundsToVisualRegion(node.bounds) } };
}

function confirmImageCheck() {
  const draft = imageCheckDraft.value;
  if (!draft || recordingLocked.value) return;
  try {
    validateImageCheck(draft.imageCheck);
    if (draft.imageCheck?.target === 'element' && (!draft.selector || draft.selector.strategy === 'bounds')) throw new Error('请选择具有有效定位信息的组件');
    if (imageCheckEditing) {
      const index = steps.value.findIndex(step => step.id === draft.id);
      if (index < 0) throw new Error('原节点已删除');
      updateStep(index, draft);
    } else insertStep(draft, imageCheckIndex, imageCheckBranch);
    imageCheckDraft.value = null;
    imageCheckPicking.value = false;
  } catch (error) { ElMessage.warning((error as Error).message); }
}

function currentVisualChangeConfig() {
  const bounds = selectedNode.value?.bounds;
  return normalizeVisualChangeConfig({
    mode: bounds ? 'selectedElement' : 'region',
    region: bounds ? boundsToVisualRegion(bounds) : defaultVisualChangeRegion(),
  } as AppiumVisualChangeConfig);
}

function createVisualChangeStartStep(config: AppiumVisualChangeConfig): AppiumRecordedStep {
  const normalizedConfig = normalizeVisualChangeConfig(config);
  const pairId = createStepId();
  const pairLabel = nextVisualChangePairLabel(steps.value);
  const visualChange = {
    ...normalizedConfig,
    role: 'start' as const,
    pairId,
    pairLabel,
    startStepId: '',
    endStepId: '',
  };
  const node = normalizedConfig.mode === 'selectedElement' ? selectedNode.value : null;
  if (node) {
    const step = createNodeActionStep('visualChange', `${pairLabel}-开始节点`, node);
    return {
      ...step,
      label: `${pairLabel}-开始节点`,
      visualChange,
      flow: { ...(step.flow || {}), nodeKind: 'assertion' },
    };
  }
  return {
    id: createStepId(),
    type: 'visualChange',
    label: `${pairLabel}-开始节点`,
    visualChange,
    flow: { nodeKind: 'assertion' },
  };
}

function createVisualChangeEndStep(startStep: AppiumRecordedStep): AppiumRecordedStep {
  const config = normalizeVisualChangeConfig(startStep.visualChange);
  const id = createStepId();
  const pairLabel = config.pairLabel || '检测画面变化';
  const pairId = config.pairId || startStep.id;
  return {
    id,
    type: 'visualChange',
    label: `${pairLabel}-结束节点`,
    visualChange: {
      ...config,
      role: 'end',
      pairId,
      startStepId: startStep.id,
      endStepId: id,
    },
    flow: { nodeKind: 'assertion' },
  };
}

function linkedScriptExitActivity(script: AppiumRecordedScript) {
  for (let index = script.steps.length - 1; index >= 0; index -= 1) {
    const activity = script.steps[index]?.pageAfter?.activity;
    if (activity) return activity;
  }
  return script.appActivity;
}

function expectedActivityAfterStep(index?: number) {
  const scriptActivity = selectedScript.value?.appActivity || form.appActivity || currentActivity.value;
  if (typeof index !== 'number' || index < 0) return scriptActivity;

  const previousStep = steps.value[index];
  if (!previousStep) return scriptActivity;
  if (previousStep.type === 'runScript') {
    const script = scripts.value.find((item) => item.id === previousStep.value);
    if (script) return linkedScriptExitActivity(script);
  }
  return previousStep.pageAfter?.activity || previousStep.pageBefore?.activity || scriptActivity;
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function treeSignature(root: AppiumNode | null) {
  return flattenNodes(root)
    .slice(0, 300)
    .map((node) => [
      node.resourceId,
      node.text,
      node.contentDesc,
      node.className,
      node.xpath,
    ].join('|'))
    .join('\n');
}

async function fetchTreePayload(forceFresh = false) {
  if (forceFresh && treeRequest) await treeRequest.catch(() => undefined);
  if (treeRequest) return treeRequest;

  const request = getAppiumTree(selectedDeviceId.value);
  treeRequest = request;
  try {
    return await request;
  } finally {
    if (treeRequest === request) treeRequest = null;
  }
}

function applyTreeSnapshot(payload: TreePayload, parsedTree: AppiumNode | null, clearSelection: boolean) {
  const previousSelection = clearSelection ? null : selectedNode.value;
  rawXml.value = payload.xml;
  currentActivity.value = payload.activity || '';
  tree.value = parsedTree;
  selectedNode.value = previousSelection
    ? flattenNodes(parsedTree).find((node) => (
        node.id === previousSelection.id || node.xpath === previousSelection.xpath
      )) || null
    : null;
}

function currentPageSnapshot(node = selectedNode.value) {
  return {
    activity: currentActivity.value,
    packageName: node?.packageName || '',
    treeSignature: treeSignature(tree.value),
    selectedNodePath: node?.xpath || '',
  };
}

function ensureAppPackageSelected() {
  if (hasSelectedAppPackage.value) return true;
  ElMessage.warning('请先从预设 App 参数中选择 App 包名');
  return false;
}

function getSelectedNode() {
  if (selectedNode.value) return selectedNode.value;
  ElMessage.warning('请先选择组件');
  return null;
}

async function loadTreeSnapshot(clearSelection = true, forceFresh = false) {
  const payload = await fetchTreePayload(forceFresh);
  const parsedTree = parseWindowHierarchy(payload.xml);
  applyTreeSnapshot(payload, parsedTree, clearSelection);
  return {
    activity: payload.activity || '',
    signature: treeSignature(parsedTree),
    tree: parsedTree,
  };
}

function stopAutoTreeRefresh() {
  if (autoTreeRefreshTimer === null) return;
  window.clearTimeout(autoTreeRefreshTimer);
  autoTreeRefreshTimer = null;
}

function scheduleAutoTreeRefresh(delay = AUTO_TREE_REFRESH_INTERVAL_MS) {
  stopAutoTreeRefresh();
  if (!props.active || !selectedDeviceId.value || replaying.value) return;
  autoTreeRefreshTimer = window.setTimeout(() => {
    autoTreeRefreshTimer = null;
    void syncTreeWhenPageChanges();
  }, delay);
}

async function pauseAutoTreeRefresh() {
  stopAutoTreeRefresh();
  const pendingRequest = treeRequest;
  if (pendingRequest) await pendingRequest.catch(() => undefined);
  await wait(300);
}

async function syncTreeWhenPageChanges() {
  if (
    autoTreeRefreshInFlight
    || loadingTree.value
    || recordingBusy.value
    || replaying.value
    || launchingApp.value
  ) {
    scheduleAutoTreeRefresh();
    return;
  }

  autoTreeRefreshInFlight = true;
  try {
    const payload = await fetchTreePayload();
    const changed = (payload.activity || '') !== currentActivity.value
      || payload.xml !== rawXml.value;
    if (changed) {
      applyTreeSnapshot(payload, parseWindowHierarchy(payload.xml), false);
    }
  } catch {
    // A transient ADB/UIAutomator failure should not interrupt recording.
  } finally {
    autoTreeRefreshInFlight = false;
    scheduleAutoTreeRefresh();
  }
}

async function loadScripts() {
  const payload = await getAppiumScripts();
  scripts.value = payload.scripts || [];
  if (selectedScriptId.value && !scripts.value.some((script) => script.id === selectedScriptId.value)) {
    selectedScriptId.value = '';
  }
}

async function switchDevice(deviceId: string) {
  stopAutoTreeRefresh();
  tree.value = null;
  selectedNode.value = null;
  currentActivity.value = '';
  await props.switchAndroidDevice(deviceId);
}

async function triggerDeviceKey(keyCode: number) {
  if (!selectedDeviceId.value) return;
  try {
    await props.triggerDeviceKey(keyCode);
    scheduleAutoTreeRefresh(500);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '设备操作失败');
  }
}

async function refreshTree() {
  if (loadingTree.value || replaying.value) return;
  if (!selectedDeviceId.value) {
    ElMessage.warning('请选择设备');
    return;
  }
  loadingTree.value = true;
  try {
    await loadTreeSnapshot(true, true);
    props.refreshDevicePreview();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '刷新组件树失败');
  } finally {
    loadingTree.value = false;
  }
}

async function executeFlowStep(index: number) {
  const step = steps.value[index];
  if (step?.type === 'aiRecognition') {
    if (replaying.value || recordingBusy.value) { ElMessage.warning('设备正在执行操作，请稍后测试'); return; }
    aiRecognitionTestStep.value = { ...step };
    return;
  }
  if (!step || (step.type !== 'launchApp' && step.type !== 'clearAppData')) return;
  if (launchingApp.value) return;
  if (!selectedDeviceId.value) {
    ElMessage.warning('请选择设备');
    return;
  }
  const packageName = step.value?.trim() || form.appPackage;
  if (!packageName || !props.appPresets.some((app) => app.packageName === packageName)) {
    ElMessage.warning('当前节点没有匹配的预设 App');
    return;
  }

  if (step.type === 'clearAppData') {
    const confirmed = await ElMessageBox.confirm(
      'Android 将清除该 App 的全部数据和缓存，登录状态与本地设置也会被重置。',
      '确认清理 App 缓存',
      {
        confirmButtonText: '确认清理',
        cancelButtonText: '取消',
        type: 'warning',
        center: true,
      },
    ).catch(() => false);
    if (!confirmed) return;
  }

  launchingApp.value = true;
  executingAppStepId.value = step.id;
  try {
    if (step.type === 'clearAppData') {
      await clearAppiumDeviceAppData({ deviceId: selectedDeviceId.value, packageName });
    } else {
      await launchAppiumDeviceApp({ deviceId: selectedDeviceId.value, packageName });
    }
    props.refreshDevicePreview();
    await wait(800);
    await loadTreeSnapshot(true, true);
    props.refreshDevicePreview();
    if (step.type === 'clearAppData') {
      ElMessage.success('App 数据与缓存已清理');
    } else if (scriptActivityMismatch.value) {
      ElMessage.warning(`App 已启动，当前页面仍为 ${currentActivity.value || '-'}`);
    } else {
      ElMessage.success('已进入脚本绑定页面');
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : 'App 操作失败');
  } finally {
    launchingApp.value = false;
    executingAppStepId.value = '';
  }
}

function selectNodeFromPoint(point: { x: number; y: number }) {
  if (pickingCoordinate.value) {
    coordinatePicker.select(point);
    return;
  }
  const node = findSmallestNodeAtPoint(tree.value, point.x, point.y);
  if (node) {
    selectedNode.value = node;
    workspaceRef.value?.showTree();
    return;
  }
  ElMessage.warning('未命中组件树节点');
}

async function swipePreview(gesture: {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  duration: number;
}) {
  if (recordingBusy.value || replaying.value) return;
  if (!selectedDeviceId.value) return;
  try {
    await props.swipeDevice(
      gesture.startX,
      gesture.startY,
      gesture.endX,
      gesture.endY,
      gesture.duration,
    );
    scheduleAutoTreeRefresh(500);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '滑动失败');
  }
}

async function recordTapStep(index?: number, branchTarget?: BranchTarget) {
  if (!selectedNode.value || recordingTap.value) return;
  if (!ensureAppPackageSelected()) return;
  if (!selectedDeviceId.value) {
    ElMessage.warning('请选择设备');
    return;
  }
  const node = selectedNode.value;
  const bounds = node.bounds;
  if (!bounds) {
    ElMessage.warning('当前组件没有可点击坐标');
    return;
  }
  const beforeActivity = currentActivity.value;
  const step = createStep('tap', node);
  const inserted = insertStep(step, index, branchTarget);
  recordingTap.value = true;
  try {
    await tapAppiumDevice({ deviceId: selectedDeviceId.value, x: bounds.centerX, y: bounds.centerY });
    await wait(1200);
    const after = await loadTreeSnapshot(true, true);
    steps.value = steps.value.map((item) => (
      item.id === step.id ? { ...item, pageAfter: currentPageSnapshot() } : item
    ));
    const activityChanged = Boolean(beforeActivity && after.activity && beforeActivity !== after.activity);
    if (activityChanged) {
      pendingNavigation.value = {
        beforeActivity,
        afterActivity: after.activity,
      };
      return step;
    }
    ElMessage.success('已录制点击');
    return step;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '录制点击失败');
    return undefined;
  } finally {
    recordingTap.value = false;
  }
}

async function addStep(type: NodeStepType, index?: number, branchTarget?: BranchTarget) {
  if (recordingBusy.value) return;
  if (!selectedNode.value) return;
  if (!ensureAppPackageSelected()) return;
  if (type === 'tap') {
    return recordTapStep(index, branchTarget);
  }
  const step = createStep(type, selectedNode.value);
  if (type === 'input') {
    const input = await ElMessageBox.prompt('', '录制输入', {
      inputValue: '',
      confirmButtonText: '添加',
      cancelButtonText: '取消',
      center: true,
    }).catch(() => null);
    if (!input) return;
    step.value = input.value;
  }
  return insertStep(step, index, branchTarget);
}

async function addDelayStep(index?: number, branchTarget?: BranchTarget) {
  if (recordingBusy.value) return;
  const input = await ElMessageBox.prompt('请输入延时时间，单位毫秒', '添加延时', {
    inputValue: '1000',
    inputPattern: /^[1-9]\d{0,5}$/,
    inputErrorMessage: '请输入 1 到 999999 之间的整数',
    confirmButtonText: '添加',
    cancelButtonText: '取消',
  }).catch(() => null);
  if (!input) return;
  const timeoutMs = Number(input.value);
  const step = createDelayStep(timeoutMs);
  return insertStep(step, index, branchTarget);
}

function toSwipeNumber(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : fallback;
}

function patchSwipeForm(form: SwipeForm, key: keyof SwipeGesture, value: unknown) {
  form[key] = toSwipeNumber(value, form[key]);
}

function renderSwipeForm(form: SwipeForm) {
  const coordinateInput = (label: string, key: keyof SwipeGesture, min = 0) => h(ElFormItem, { label }, () => h(ElInputNumber, {
    modelValue: form[key],
    min,
    max: 99999,
    precision: 0,
    controlsPosition: 'right',
    'onUpdate:modelValue': (value: number | undefined) => patchSwipeForm(form, key, value),
  }));

  return h(ElForm, { labelPosition: 'top', size: 'small', class: 'appium-swipe-dialog-form' }, () => [
    h(ElFormItem, { label: '滑动方向' }, () => h(ElSelect, {
      modelValue: form.direction,
      'onUpdate:modelValue': (value: string) => {
        const preset = swipePreset(value);
        form.direction = preset.direction;
        Object.assign(form, preset.swipe);
      },
    }, () => [
      h(ElOption, { label: '上滑', value: 'up' }),
      h(ElOption, { label: '下滑', value: 'down' }),
      h(ElOption, { label: '左滑', value: 'left' }),
      h(ElOption, { label: '右滑', value: 'right' }),
    ])),
    h('div', { class: 'appium-swipe-dialog-grid' }, () => [
      coordinateInput('起点 X', 'startX'),
      coordinateInput('起点 Y', 'startY'),
      coordinateInput('终点 X', 'endX'),
      coordinateInput('终点 Y', 'endY'),
      coordinateInput('时长 ms', 'duration', 80),
    ]),
  ]);
}

async function addSwipeStep(index?: number, branchTarget?: BranchTarget) {
  const preset = swipePreset('up');
  const form = reactive<SwipeForm>({
    direction: preset.direction,
    ...preset.swipe,
  });
  const result = await ElMessageBox({
    title: '添加滑动',
    message: renderSwipeForm(form),
    showCancelButton: true,
    confirmButtonText: '添加',
    cancelButtonText: '取消',
    customClass: 'appium-swipe-message-box',
  }).catch(() => null);
  if (!result) return;
  const finalPreset = swipePreset(form.direction);
  return insertStep(createSwipeStep({
    label: finalPreset.label,
    swipe: {
      startX: toSwipeNumber(form.startX, finalPreset.swipe.startX),
      startY: toSwipeNumber(form.startY, finalPreset.swipe.startY),
      endX: toSwipeNumber(form.endX, finalPreset.swipe.endX),
      endY: toSwipeNumber(form.endY, finalPreset.swipe.endY),
      duration: Math.max(80, toSwipeNumber(form.duration, finalPreset.swipe.duration)),
    },
  }), index, branchTarget);
}

function openLinkedScriptDialog(index?: number, branchTarget?: BranchTarget) {
  linkedScriptEditingId.value = '';
  if (!linkableScripts.value.length) {
    ElMessage.warning('暂无可连接的已保存脚本');
    return;
  }
  linkedScriptBranchTarget.value = branchTarget || null;
  linkedScriptExpectedActivity.value = expectedActivityAfterStep(index);
  if (!compatibleLinkableScripts.value.length) {
    ElMessage.warning('没有属于当前 App 的可连接脚本');
    linkedScriptExpectedActivity.value = '';
    linkedScriptBranchTarget.value = null;
    return;
  }
  linkedScriptTargetId.value = compatibleLinkableScripts.value[0]?.id || '';
  linkedParameters.parameters = [];
  linkedParameters.returns = [];
  linkedScriptInsertIndex.value = index;
  linkedScriptDialogVisible.value = true;
}

function addLinkedScriptStep() {
  try { validateVariables(linkedParameters.parameters); validateReturns(linkedParameters.returns); }
  catch (error) { ElMessage.error(String(error)); return; }
  const script = scripts.value.find((item) => item.id === linkedScriptTargetId.value);
  if (!script) {
    ElMessage.warning('请选择要连接的脚本');
    return;
  }
  if (script.appPackage !== form.appPackage) {
    ElMessage.error('连接脚本必须属于当前 App');
    return;
  }
  const editingIndex = linkedScriptEditingId.value ? steps.value.findIndex(step => step.id === linkedScriptEditingId.value) : -1;
  if (linkedScriptEditingId.value && editingIndex < 0) { ElMessage.warning('原节点已删除，请重新打开'); return; }
  if (editingIndex >= 0) {
    const original = steps.value[editingIndex]!;
    updateStep(editingIndex, { ...original, value: script.id,
      ...(original.label.startsWith('连接脚本 ') ? { label: `连接脚本 ${script.name}` } : {}),
      parameters: JSON.parse(JSON.stringify(linkedParameters.parameters || [])), returns: JSON.parse(JSON.stringify(linkedParameters.returns || [])) });
  } else insertStep(
    { ...createRunScriptStep(script), parameters: JSON.parse(JSON.stringify(linkedParameters.parameters || [])), returns: JSON.parse(JSON.stringify(linkedParameters.returns || [])) },
    linkedScriptInsertIndex.value,
    linkedScriptBranchTarget.value || undefined,
  );
  linkedScriptInsertIndex.value = undefined;
  linkedScriptBranchTarget.value = null;
  linkedScriptExpectedActivity.value = '';
  linkedScriptDialogVisible.value = false;
  ElMessage.success(editingIndex >= 0 ? '已修改连接脚本' : '已添加连接脚本步骤');
  linkedScriptEditingId.value = '';
}

function closeLinkedScriptDialog() {
  linkedScriptEditingId.value = '';
  linkedScriptDialogVisible.value = false;
  linkedScriptInsertIndex.value = undefined;
  linkedScriptBranchTarget.value = null;
  linkedScriptExpectedActivity.value = '';
}

function openLinkedScriptPreview(scriptId = linkedScriptTargetId.value) {
  const script = scripts.value.find((item) => item.id === scriptId);
  if (!script) {
    ElMessage.warning('请选择要预览的脚本');
    return;
  }
  linkedScriptPreviewScriptId.value = script.id;
  linkedScriptPreviewResetToken.value += 1;
  linkedScriptPreviewVisible.value = true;
}

function previewLinkedScriptStep(index: number) {
  openLinkedScriptPreview(steps.value[index]?.value || '');
}

function loadPreviewScriptForEditing() {
  if (!linkedScriptPreviewScript.value) return;
  linkedScriptPreviewVisible.value = false;
  linkedScriptDialogVisible.value = false;
  loadScript(linkedScriptPreviewScript.value);
}

function openVisualChangeDialog(index?: number, branchTarget?: BranchTarget) {
  visualChangeInsertIndex.value = index;
  visualChangeBranchTarget.value = branchTarget || null;
  visualChangeConfig.value = currentVisualChangeConfig();
  visualChangePicking.value = false;
  visualChangeDialogVisible.value = true;
}

function closeVisualChangeDialog() {
  visualChangeDialogVisible.value = false;
  visualChangePicking.value = false;
  visualChangeInsertIndex.value = undefined;
  visualChangeBranchTarget.value = null;
}

function updateVisualChangeConfig(config: AppiumVisualChangeConfig) {
  visualChangeConfig.value = normalizeVisualChangeConfig(config);
}

function pickVisualChangeRegion() {
  if (!selectedDeviceId.value) {
    ElMessage.warning('请选择设备');
    return;
  }
  visualChangeConfig.value = normalizeVisualChangeConfig({
    ...visualChangeConfig.value,
    mode: 'region',
  });
  visualChangePicking.value = true;
  workspaceRef.value?.showPreview();
  ElMessage.info('请在设备预览中拖拽框选检测区域');
}

function applyVisualChangeRegion(region: AppiumVisualChangeRegion) {
  if (imageCheckDraft.value?.imageCheck) {
    updateImageCheck({ ...imageCheckDraft.value.imageCheck, region, screenWidth: props.deviceWidth || 0, screenHeight: props.deviceHeight || 0 });
    imageCheckPicking.value = false;
    return;
  }
  visualChangeConfig.value = normalizeVisualChangeConfig({
    ...visualChangeConfig.value,
    mode: 'region',
    region,
  });
  visualChangePicking.value = false;
  ElMessage.success('已选择检测区域');
}

function confirmVisualChangeStep() {
  const config = normalizeVisualChangeConfig(visualChangeConfig.value);
  if (config.mode === 'selectedElement' && !selectedNode.value?.bounds) {
    ElMessage.warning('当前没有可用的选中元素，请先选择组件或改为手动框选区域');
    return;
  }
  const step = createVisualChangeStartStep(config);
  insertStep(
    step,
    visualChangeInsertIndex.value,
    visualChangeBranchTarget.value || undefined,
  );
  closeVisualChangeDialog();
  ElMessage.success('已添加检测画面变化开始节点');
}

function isReadonlyFlowActionDisabled(_action: InsertAction) {
  return true;
}

function isReadonlyFlowAppExecutionDisabled(_action: 'launchApp' | 'clearAppData') {
  return true;
}

function isReadonlyFlowCopySelected(_index: number) {
  return false;
}

function addSharedAction(action: RecorderAction, index: number, beforeStepId?: string) {
  if (!beforeStepId) return addAction(action, index);
  const target = steps.value.find(step => step.id === beforeStepId);
  if (!target) return;
  return addAction(action, index, { beforeStepId, stepId: target.flow?.parentConditionId || '', branch: target.flow?.parentBranch || 'yes' });
}

async function addAction(
  action: RecorderAction,
  index?: number,
  branchTarget?: BranchTarget,
) {
  if (recordingBusy.value) return;
  if (!ensureAppPackageSelected()) return;
  if (action === 'clearAppData' && steps.value.some((step) => step.type === 'clearAppData')) {
    ElMessage.warning('清理 App 缓存节点只能添加一个');
    return;
  }
  if (action === 'clearAppData' && index !== -1) {
    ElMessage.warning('清理 App 缓存只能从开始节点添加');
    return;
  }
  if (action === 'runScript') {
    openLinkedScriptDialog(index, branchTarget);
    return;
  }
  if (action === 'delay') {
    return addDelayStep(index, branchTarget);
  }
  if (action === 'openGallery') {
    return insertStep({ id: createStepId(), type: 'openGallery', label: '启动相册', flow: { nodeKind: 'action' } }, index, branchTarget);
  }
  if (action === 'endFlow') {
    return insertStep({ id: createStepId(), type: 'endFlow', label: '终止流程', flow: { nodeKind: 'action' } }, index, branchTarget);
  }
  if (action === 'loop') {
    const step = reactive<AppiumRecordedStep>({
      id: createStepId(), type: 'loop', label: '有界循环', loop: defaultLoopConfig(),
      selector: selectedNode.value?.selector ? { ...selectedNode.value.selector } : { strategy: 'id', value: '' },
      flow: { nodeKind: 'condition' },
    });
    const result = await ElMessageBox({
      title: '添加有界循环',
      message: h(ElForm, { labelPosition: 'top' }, () => h(LoopSettings, { step, onUpdate: (patch) => Object.assign(step, patch) })),
      showCancelButton: true, confirmButtonText: '添加', cancelButtonText: '取消',
      beforeClose: (action, _instance, done) => {
        if (action === 'confirm') {
          try { validateLoop(step); } catch (error) { ElMessage.warning((error as Error).message); return; }
        }
        done();
      },
    }).catch(() => null);
    if (result) return insertStep({ ...step, loop: { ...step.loop! }, selector: { ...step.selector! } }, index, branchTarget);
    return;
  }
  if (action === 'breakLoop') {
    const step: AppiumRecordedStep = { id: createStepId(), type: 'breakLoop', label: '退出循环', flow: { nodeKind: 'action' } };
    const scoped = reactive(branchTarget ? stepWithBranchTarget(step, branchTarget) : step);
    const loops = enclosingLoops(steps.value, scoped);
    if (!loops.length) { ElMessage.warning('退出循环只能添加在循环体内'); return; }
    scoped.breakLoopTargetId = loops[0]!.id;
    const result = await ElMessageBox({
      title: '添加退出循环',
      message: h(ElForm, { labelPosition: 'top' }, () => h(BreakLoopSettings, { step: scoped, steps: steps.value, onUpdate: (patch) => Object.assign(scoped, patch) })),
      showCancelButton: true, confirmButtonText: '添加', cancelButtonText: '取消',
      beforeClose: (action, _instance, done) => {
        if (action === 'confirm') {
          try { breakLoopTarget(steps.value, scoped); } catch (error) { ElMessage.warning((error as Error).message); return; }
        }
        done();
      },
    }).catch(() => null);
    if (result) return insertStep({ ...step, breakLoopTargetId: scoped.breakLoopTargetId }, index, branchTarget);
    return;
  }
  if (action === 'continueLoop') {
    const step: AppiumRecordedStep = { id: createStepId(), type: 'continueLoop', label: '继续下一次循环', flow: { nodeKind: 'action' } };
    const scoped = reactive(branchTarget ? stepWithBranchTarget(step, branchTarget) : step);
    const loops = enclosingLoops(steps.value, scoped);
    if (!loops.length) { ElMessage.warning('继续下一次循环只能添加在循环体内'); return; }
    scoped.continueLoopTargetId = loops[0]!.id;
    const result = await ElMessageBox({
      title: '添加继续下一次循环',
      message: h(ElForm, { labelPosition: 'top' }, () => h(BreakLoopSettings, {
        step: scoped,
        steps: steps.value,
        mode: 'continue',
        onUpdate: (patch) => Object.assign(scoped, patch),
      })),
      showCancelButton: true, confirmButtonText: '添加', cancelButtonText: '取消',
      beforeClose: (action, _instance, done) => {
        if (action === 'confirm') {
          try { continueLoopTarget(steps.value, scoped); } catch (error) { ElMessage.warning((error as Error).message); return; }
        }
        done();
      },
    }).catch(() => null);
    if (result) return insertStep({ ...step, continueLoopTargetId: scoped.continueLoopTargetId }, index, branchTarget);
    return;
  }
  if (action === 'imageCheck') {
    imageCheckIndex = index;
    imageCheckBranch = branchTarget;
    imageCheckEditing = false;
    imageCheckPicking.value = false;
    imageCheckDraft.value = { id: createStepId(), type: 'imageCheck', label: '图像判断', flow: { nodeKind: 'condition' },
      imageCheck: { ...createImageCheckConfig(), region: defaultVisualChangeRegion(), screenWidth: props.deviceWidth || 0, screenHeight: props.deviceHeight || 0 } };
    if (selectedNode.value?.bounds) useImageCheckElement();
    return;
  }
  if (action === 'aiRecognition') {
    const draft = reactive({ value: '', error: '' });
    const result = await ElMessageBox({
      title: '添加 AI 识别',
      message: () => h(ElForm, { labelPosition: 'top', style: { width: 'min(380px, calc(100vw - 64px))' } },
        () => h(ElFormItem, { label: '识别内容', error: draft.error },
          () => h(AiRecognitionPromptInput, {
            modelValue: draft.value, presets: availableAiPromptPresets.value,
            placeholder: '例如：检查当前画面有没有显示黑屏',
            'onUpdate:modelValue': (value: string) => { draft.value = value; draft.error = ''; },
          }))),
      showCancelButton: true, confirmButtonText: '添加', cancelButtonText: '取消',
      beforeClose: (action, _instance, done) => {
        if (action === 'confirm') {
          try { draft.value = validateAiRecognitionPrompt(draft.value); }
          catch (error) { draft.error = error instanceof Error ? error.message : '识别内容无效'; return; }
        }
        done();
      },
    }).catch(() => null);
    if (!result) return;
    return insertStep({ id: createStepId(), type: 'aiRecognition', label: 'AI 识别', value: draft.value, aiBranchEnabled: false, timeoutMs: DEFAULT_NODE_TIMEOUT_MS, flow: { nodeKind: 'action' } }, index, branchTarget);
  }
  if (action === 'textClick') {
    const step = reactive<AppiumRecordedStep>({
      id: createStepId(), type: 'textClick', label: '文字点击', value: '', timeoutMs: DEFAULT_NODE_TIMEOUT_MS,
      flow: { nodeKind: 'condition', textMatch: 'exact' },
    });
    const result = await ElMessageBox({
      title: '添加文字点击',
      message: h(ElForm, { labelPosition: 'top', style: { width: 'min(380px, calc(100vw - 64px))' } },
        () => h(TextClickSettings, { step, onUpdate: (patch) => Object.assign(step, patch) })),
      showCancelButton: true, confirmButtonText: '添加', cancelButtonText: '取消',
      beforeClose: (action, _instance, done) => {
        if (action === 'confirm') {
          try { textClickSelector(step); }
          catch (error) { ElMessage.warning((error as Error).message); return; }
        }
        done();
      },
    }).catch(() => null);
    if (result) return insertStep({ ...step }, index, branchTarget);
    return;
  }
  if (action === 'tap' || action === 'input' || action === 'waitFor') {
    return addStep(action, index, branchTarget);
  }
  if (action === 'keyBack') {
    return insertStep(createKeyStep(4, '系统返回'), index, branchTarget);
  }
  if (action === 'keyHome') {
    return insertStep(createKeyStep(3, 'Home 键'), index, branchTarget);
  }
  if (action === 'keyRecent') {
    return insertStep(createKeyStep(187, '最近任务'), index, branchTarget);
  }
  if (action === 'keyPower') {
    return insertStep(createKeyStep(26, '电源键'), index, branchTarget);
  }
  if (action === 'waitActivity') {
    const input = await ElMessageBox.prompt('请输入目标 Activity', '等待 Activity', {
      inputValue: currentActivity.value,
      confirmButtonText: '添加',
      cancelButtonText: '取消',
    }).catch(() => null);
    if (input?.value) return insertStep(createWaitActivityStep(input.value), index, branchTarget);
    return;
  }
  if (action === 'swipe') {
    return addSwipeStep(index, branchTarget);
  }
  if (action === 'visualChange' || action === 'visualChangeStart') {
    openVisualChangeDialog(index, branchTarget);
    return;
  }
  if (action === 'visualChangeEnd') {
    const candidates = findOpenVisualChangeStarts(steps.value, index, branchTarget);
    if (!candidates.length) {
      ElMessage.warning('当前分支没有可对应的检测画面变化开始节点');
      return;
    }
    let selectedId = candidates.length === 1 ? candidates[0].id : '';
    if (candidates.length > 1) {
      selectedId = await new Promise<string>((resolve) => { void ElMessageBox({
        title: '选择要结束的画面变化检测',
        showConfirmButton: false,
        showCancelButton: false,
        callback: () => resolve(''),
        message: h(VisualChangeEndPicker, {
          candidates: candidates.map(step => ({ id: step.id, label: step.visualChange?.pairLabel || step.label, number: steps.value.findIndex(item => item.id === step.id) + 1 })),
          onSelect: (id: string) => { resolve(id); ElMessageBox.close(); },
        }),
      }); });
      if (!selectedId) return;
    }
    // 选择期间流程可能发生变化；插入前重新检查配对，不能使用过期候选。
    const startStep = findOpenVisualChangeStarts(steps.value, index, branchTarget).find(step => step.id === selectedId);
    if (!startStep) {
      ElMessage.warning('该开始节点已结束或不再属于当前路径，请重新选择');
      return;
    }
    const inserted = insertStep(createVisualChangeEndStep(startStep), index, branchTarget);
    ElMessage.success(`已添加 ${inserted.label}`);
    return inserted;
  }
  if (action === 'pinch') {
    const input = await ElMessageBox.prompt('请输入缩放方向：放大 / 缩小', '添加双指缩放', {
      inputValue: '放大',
      inputPattern: /^(放大|缩小|out|in)$/,
      inputErrorMessage: '只能输入 放大 或 缩小',
      confirmButtonText: '添加',
      cancelButtonText: '取消',
    }).catch(() => null);
    if (!input?.value) return;
    const direction = input.value === '缩小' || input.value === 'in' ? 'in' : 'out';
    return insertStep({
      id: `step_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'pinch',
      label: direction === 'out' ? '双指放大' : '双指缩小',
      pinch: {
        direction,
        centerX: Math.round((props.deviceWidth || 1080) / 2),
        centerY: Math.round((props.deviceHeight || 1920) / 2),
        percent: 0.5,
      },
    }, index, branchTarget);
  }
  if (action === 'noop') {
    return insertStep(createNoopStep(), index, branchTarget);
  }
  if (action === 'log') {
    const step = reactive<AppiumRecordedStep>({
      id: createStepId(), type: 'log', label: '输出日志', logPrefix: DEFAULT_LOG_PREFIX, value: '',
    });
    const result = await ElMessageBox({
      title: '添加输出日志',
      message: h(ElForm, { labelPosition: 'top', style: { width: 'min(380px, calc(100vw - 64px))' } }, () => h(StageLogSettings, {
        step, onUpdate: (patch) => Object.assign(step, patch),
      })),
      showCancelButton: true, confirmButtonText: '添加', cancelButtonText: '取消',
      beforeClose: (action, _instance, done) => {
        const error = action === 'confirm' ? validateStageLog(step) : '';
        if (error) { ElMessage.warning(error); return; }
        done();
      },
    }).catch(() => null);
    if (result) return insertStep({ ...step }, index, branchTarget);
    return;
  }
  if (action === 'launchApp') {
    return insertStep({
      id: `step_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'launchApp',
      label: `启动 APP ${form.appPackage}`,
      value: form.appPackage,
    }, index, branchTarget);
  }
  if (action === 'stopApp') {
    return insertStep({ id: createStepId(), type: 'stopApp', label: `杀死 APP ${form.appPackage}`,
      value: form.appPackage, flow: { nodeKind: 'action' } }, index, branchTarget);
  }
  if (action === 'clearAppData') {
    return insertStep({
      id: `step_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'clearAppData',
      label: `清理 APP 缓存（含数据）${form.appPackage}`,
      value: form.appPackage,
    }, index);
  }
  const node = getSelectedNode();
  if (!node) return;
  if (action === 'extractVariable') {
    const step = reactive<AppiumRecordedStep>({ ...createNodeActionStep('extractVariable', '提取变量', node), extractVariable: { name: '', attribute: 'text', sensitive: false }, flow: { nodeKind: 'action' } });
    const result = await ElMessageBox({
      title: '提取组件到变量',
      message: h(ElForm, { labelPosition: 'top' }, () => h(VariableExtractionSettings, { step, onUpdate: patch => Object.assign(step, patch) })),
      showCancelButton: true, confirmButtonText: '添加', cancelButtonText: '取消',
      beforeClose: (action, _instance, done) => {
        if (action === 'confirm') {
          try { validateExtraction(step.extractVariable); } catch (error) { ElMessage.error(String(error)); return; }
        }
        done();
      },
    }).catch(() => null);
    if (result) return insertStep(JSON.parse(JSON.stringify(step)), index, branchTarget);
    return;
  }
  if (action === 'checkboxState' || action === 'radioButtonState' || action === 'checkedState') {
    const controlName = nativeControlName(action);
    if (!matchesNativeControl(action, node.className) || node.checkable !== true) {
      ElMessage.warning(`请选择原生 ${controlName} 元素，当前选中：${node.className || '未知类型'}`);
      return;
    }
    const step = createNodeActionStep(action, action === 'checkedState' ? '判断勾选' : `判断 ${controlName} 状态`, node, { timeoutMs: DEFAULT_NODE_TIMEOUT_MS });
    if ((!step.selector?.value || step.selector.strategy === 'bounds') && node.xpath) {
      step.selector = { strategy: 'xpath', value: node.xpath };
      step.contextSelector = undefined;
      step.selectorChain = undefined;
    }
    if (!step.selector?.value || step.selector.strategy === 'bounds') {
      ElMessage.warning(`当前 ${controlName} 没有可用的元素定位器`);
      return;
    }
    // 只保存定位信息，回放时读取实时状态；坐标不能用于判断元素属性。
    step.fallback = undefined;
    step.flow = { nodeKind: 'condition' };
    return insertStep(step, index, branchTarget);
  }
  if (action === 'popupCondition') {
    const step = createNodeActionStep('assertExists', '判断存在', node, { timeoutMs: DEFAULT_NODE_TIMEOUT_MS });
    const inserted = insertStep({ ...step, flow: { nodeKind: 'condition' } }, index, branchTarget);
    ElMessage.success('已添加判断节点，请在节点面板配置是/否分支');
    return inserted;
  }
  if (action === 'tapIfExists') {
    return insertStep(createNodeActionStep('tapIfExists', '存在则点击', node, { timeoutMs: DEFAULT_NODE_TIMEOUT_MS }), index, branchTarget);
  }
  if (action === 'inputIfExists') {
    const input = await ElMessageBox.prompt('', '存在则输入', {
      inputValue: '',
      confirmButtonText: '添加',
      cancelButtonText: '取消',
      center: true,
    }).catch(() => null);
    if (!input) return;
    return insertStep(
      createNodeActionStep('inputIfExists', '存在则输入', node, { timeoutMs: DEFAULT_NODE_TIMEOUT_MS, value: input.value }),
      index,
      branchTarget,
    );
  }
  if (action === 'clearIfExists') {
    return insertStep(createNodeActionStep('clearIfExists', '存在则清空', node, { timeoutMs: DEFAULT_NODE_TIMEOUT_MS }), index, branchTarget);
  }
  if (action === 'backIfExists') {
    return insertStep(createNodeActionStep('backIfExists', '存在则返回', node, { timeoutMs: DEFAULT_NODE_TIMEOUT_MS }), index, branchTarget);
  }
  if (action === 'clearInput') {
    return insertStep(createNodeActionStep('clearInput', '清空输入', node), index, branchTarget);
  }
  if (action === 'coordinateTap') {
    if (!node.bounds) {
      ElMessage.warning('当前组件没有可点击坐标');
      return;
    }
    return insertStep({
      id: `step_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'coordinateTap',
      label: `点击坐标 ${node.bounds.centerX},${node.bounds.centerY}`,
      fallback: { strategy: 'bounds', centerX: node.bounds.centerX, centerY: node.bounds.centerY },
    }, index, branchTarget);
  }
  if (action === 'longPress') {
    const step = reactive<AppiumRecordedStep>({
      ...createNodeActionStep('longPress', '长按', node, { timeoutMs: 800 }),
      longPressMode: 'element',
    });
    // 无 id/text 的组件仍可用组件树中的绝对 XPath 定位，不依赖录制坐标。
    if ((!step.selector?.value || step.selector.strategy === 'bounds') && node.xpath) {
      step.selector = { strategy: 'xpath', value: node.xpath };
      step.contextSelector = undefined;
      step.selectorChain = undefined;
    }
    const result = await ElMessageBox({
      title: '添加长按',
      message: h(ElForm, { labelPosition: 'top', size: 'small' }, () => [
        h(ElFormItem, { label: '当前元素' }, () => h('div', { style: { overflowWrap: 'anywhere' } }, node.label)),
        h(LongPressSettings, { step, onUpdate: (patch) => Object.assign(step, patch) }),
      ]),
      showCancelButton: true,
      confirmButtonText: '添加',
      cancelButtonText: '取消',
      beforeClose: (action, _instance, done) => {
        const error = action === 'confirm' ? validateLongPress(step) : '';
        if (error) { ElMessage.warning(error); return; }
        done();
      },
    }).catch(() => null);
    if (!result) return;
    return insertStep({ ...step }, index, branchTarget);
  }
  if (action === 'waitDisappear') {
    return insertStep(createNodeActionStep('waitDisappear', '等待元素消失', node, { timeoutMs: DEFAULT_NODE_TIMEOUT_MS }), index, branchTarget);
  }
}

async function addBranchAction(index: number, branch: BranchName, action: RecorderAction) {
  const context = branchContextForInsert(index, branch);
  if (!context) return;
  const { condition, conditionIndex } = context;
  const existingBranchSteps = steps.value.filter((step) => (
    step.flow?.parentConditionId === condition.id && step.flow.parentBranch === branch
  ));
  const currentTargetId = branch === 'yes' ? condition.flow?.yesTargetId : condition.flow?.noTargetId;
  const currentTarget = steps.value.find((step) => step.id === currentTargetId);
  const targetIsBranchStep = currentTarget?.flow?.parentConditionId === condition.id
    && currentTarget.flow.parentBranch === branch;
  const insertAtBranchEntry = index === conditionIndex;
  const insertIndex = insertAtBranchEntry ? conditionIndex : index;
  const nextTargetId = insertAtBranchEntry
    ? nextBranchStepAfter(condition.id, branch, index)?.id || (!targetIsBranchStep ? currentTargetId : undefined)
    : undefined;
  const branchTarget: BranchTarget = {
    stepId: condition.id,
    branch,
    updateTarget: insertAtBranchEntry || !currentTargetId || !targetIsBranchStep,
    entryTargetId: insertAtBranchEntry ? undefined : existingBranchSteps[0]?.id,
    nextTargetId,
  };
  const inserted = await addAction(action, insertIndex, branchTarget);
  if (!inserted) return;
  const currentInserted = steps.value.find((step) => step.id === inserted.id);
  if (currentInserted?.flow?.parentConditionId === condition.id && currentInserted.flow.parentBranch === branch) return;
  applyBranchTargetToInsertedStep(inserted, branchTarget);
}

function continueOnActivityChange() {
  if (!pendingNavigation.value || resolvingNavigation.value) return;
  // 跨页面继续录制时，入口仍是首次录制页面，不能改成跳转后的页面。
  form.appActivity ||= pendingNavigation.value.beforeActivity;
  pendingNavigation.value = null;
  ElMessage.success('已继续录制，后续操作将加入当前脚本');
}

async function saveOnActivityChange() {
  const pending = pendingNavigation.value;
  if (!pending || resolvingNavigation.value) return;
  if (!ensureAppPackageSelected()) return;
  resolvingNavigation.value = true;
  const activityName = (pending.beforeActivity || 'Activity').split(/[/.]/).filter(Boolean).pop() || 'Activity';
  const scriptName = form.name.trim() || `${activityName}-${Date.now().toString(36).slice(-4)}`;
  try {
    const payload = await saveAppiumScript({
      id: selectedScriptId.value || undefined,
      name: scriptName,
      appPackage: form.appPackage,
      appActivity: form.appActivity || pending.beforeActivity,
      deviceId: selectedDeviceId.value,
      steps: steps.value,
      variables: scriptVariables.value,
    });
    await loadScripts();
    pendingNavigation.value = null;
    resetCurrentScript();
    form.appActivity = pending.afterActivity;
    markDraftSaved();
    ElMessage.success(`脚本「${payload.script.name}」已保存，可开始录制新 Activity`);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存脚本失败');
  } finally {
    resolvingNavigation.value = false;
  }
}

function removeStep(index: number) {
  if (recordingBusy.value) return;
  steps.value = removeFlowStep(steps.value, index);
}

function syncVisualChangePairConfig(
  candidate: AppiumRecordedStep,
  sourceConfig: NonNullable<AppiumRecordedStep['visualChange']>,
) {
  if (candidate.visualChange?.role !== 'end') return candidate;
  if (!sourceConfig.pairId || candidate.visualChange.pairId !== sourceConfig.pairId) return candidate;
  return {
    ...candidate,
    visualChange: {
      ...candidate.visualChange,
      mode: sourceConfig.mode,
      region: sourceConfig.region,
      pairLabel: sourceConfig.pairLabel,
      durationMs: sourceConfig.durationMs,
      intervalMs: sourceConfig.intervalMs,
      changeRatioThreshold: sourceConfig.changeRatioThreshold,
      pixelmatchThreshold: sourceConfig.pixelmatchThreshold,
    },
  };
}

function updateStep(index: number, step: AppiumRecordedStep) {
  if (recordingLocked.value) return;
  const visualChange = step.visualChange?.role === 'start'
    ? normalizeVisualChangeConfig(step.visualChange)
    : undefined;
  const nextSteps = steps.value.map((candidate, stepIndex) => (
    stepIndex === index
      ? step
      : visualChange
        ? syncVisualChangePairConfig(candidate, visualChange)
        : candidate
  ));
  steps.value = syncVisualChangeThreshold(nextSteps, step);
}

async function editInputStep(index: number) {
  const step = steps.value[index];
  if (step?.type === 'runScript' && !recordingBusy.value) {
    const parentId = step.flow?.parentConditionId;
    openLinkedScriptDialog(index - 1, parentId && step.flow?.parentBranch ? { stepId: parentId, branch: step.flow.parentBranch } : undefined);
    if (!linkedScriptDialogVisible.value) return;
    linkedScriptEditingId.value = step.id;
    linkedScriptTargetId.value = step.value || '';
    linkedParameters.parameters = JSON.parse(JSON.stringify(step.parameters || []));
    linkedParameters.returns = JSON.parse(JSON.stringify(step.returns || []));
    return;
  }
  if (step?.type === 'imageCheck' && !recordingBusy.value) {
    imageCheckIndex = index;
    imageCheckEditing = true;
    imageCheckPicking.value = false;
    imageCheckDraft.value = JSON.parse(JSON.stringify(step));
    return;
  }
  if (!step || (step.type !== 'input' && step.type !== 'inputIfExists') || recordingBusy.value) return;
  const input = await ElMessageBox.prompt('', '修改输入内容', {
    inputValue: step.value || '',
    confirmButtonText: '保存',
    cancelButtonText: '取消',
    center: true,
  }).catch(() => null);
  if (!input) return;
  const nextSteps = [...steps.value];
  nextSteps[index] = { ...step, value: input.value };
  steps.value = nextSteps;
}

function setActiveWorkbenchTab(tab: string | number) {
  const nextTab = tab === 'scripts' ? 'scripts' : tab === 'variables' ? 'variables' : 'recording';
  activeWorkbenchTab.value = nextTab;
  window.localStorage.setItem(WORKBENCH_TAB_STORAGE_KEY, nextTab);
}

function loadScript(script: AppiumRecordedScript) {
  setActiveWorkbenchTab('recording');
  flowClipboard.value = null;
  selectedScriptId.value = script.id;
  form.name = script.name;
  form.appPackage = script.appPackage;
  form.appActivity = script.appActivity;
  scriptVariables.value = JSON.parse(JSON.stringify(script.variables || []));
  if (script.deviceId && script.deviceId !== selectedDeviceId.value) {
    void switchDevice(script.deviceId);
  }
  steps.value = normalizeLegacyNestedConditionBranches((script.steps || []).map(normalizeLegacyFlowScope));
  markDraftSaved();
}

function loadSelectedScript() {
  if (selectedScript.value) {
    loadScript(selectedScript.value);
    return;
  }
  resetCurrentScript();
}

function resetCurrentScript() {
  void saveVariables('/api/appium-recorder/variables?draft=1', []).catch(() => ElMessage.error('变量草稿清理失败'));
  scriptVariables.value = [];
  flowClipboard.value = null;
  selectedScriptId.value = '';
  form.name = '';
  form.appActivity = '';
  steps.value = [];
  replayOutput.value = '';
  markDraftSaved();
}

function requestNewScript() {
  if (newScriptDisabled.value) return;
  if (selectedScriptId.value || form.name.trim() || steps.value.length || scriptVariables.value.length) {
    newScriptDialogVisible.value = true;
    return;
  }
  startNewScript();
}

function startNewScript() {
  if (newScriptDisabled.value) return;
  resetCurrentScript();
  // 新脚本不沿用旧画布的展开、批量选择和缩放状态。
  newScriptRevision.value += 1;
  newScriptDialogVisible.value = false;
  setActiveWorkbenchTab('recording');
}

async function saveAndNewScript() {
  if (newScriptDisabled.value) return;
  // 保存成功后才重置，校验错误或网络异常均保留当前草稿。
  if (await saveScript()) startNewScript();
}

function formatScriptTime(value: string) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
}

function cloneScriptSteps(stepList: AppiumRecordedStep[]) {
  return JSON.parse(JSON.stringify(stepList || [])) as AppiumRecordedStep[];
}

function isScriptNameTaken(name: string, exceptId = '') {
  return scripts.value.some((script) => script.id !== exceptId && script.name === name);
}

function createDuplicateScriptName(sourceName: string) {
  const baseName = `${sourceName} Copy`;
  if (!isScriptNameTaken(baseName)) return baseName;

  let suffix = 2;
  let nextName = `${baseName} ${suffix}`;
  while (isScriptNameTaken(nextName)) {
    suffix += 1;
    nextName = `${baseName} ${suffix}`;
  }
  return nextName;
}

async function duplicateScript(script: AppiumRecordedScript) {
  if (duplicatingScriptId.value) return;
  duplicatingScriptId.value = script.id;
  try {
    const payload = await saveAppiumScript({
      name: createDuplicateScriptName(script.name),
      variables: script.variables || [],
      appPackage: script.appPackage,
      appActivity: script.appActivity,
      deviceId: script.deviceId,
      steps: cloneScriptSteps(script.steps),
    });
    await loadScripts();
    ElMessage.success(`已复制为「${payload.script.name}」`);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '复制脚本失败');
  } finally {
    duplicatingScriptId.value = '';
  }
}

async function renameScript(script: AppiumRecordedScript) {
  if (renamingScriptId.value) return;
  const input = await ElMessageBox.prompt('请输入新的脚本名称', '修改脚本名称', {
    inputValue: script.name,
    confirmButtonText: '保存',
    cancelButtonText: '取消',
    center: true,
    inputValidator(value) {
      const nextName = String(value || '').trim();
      if (!nextName) return '脚本名称不能为空';
      if (isScriptNameTaken(nextName, script.id)) return '脚本名称已存在';
      return true;
    },
  }).catch(() => null);
  const nextName = input ? String(input.value || '').trim() : '';
  if (!nextName || nextName === script.name) return;

  const wasCurrentScript = selectedScriptId.value === script.id;
  const hadUnsavedChanges = hasUnsavedChanges.value;
  renamingScriptId.value = script.id;
  try {
    const payload = await saveAppiumScript({
      id: script.id,
      name: nextName,
      appPackage: script.appPackage,
      appActivity: script.appActivity,
      deviceId: script.deviceId,
      steps: cloneScriptSteps(script.steps),
    });
    await loadScripts();
    if (wasCurrentScript) {
      form.name = payload.script.name;
      if (!hadUnsavedChanges) {
        markDraftSaved();
      }
    }
    ElMessage.success('脚本名称已修改');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '修改脚本名称失败');
  } finally {
    renamingScriptId.value = '';
  }
}

async function removeScript(script: AppiumRecordedScript) {
  try {
    await ElMessageBox.confirm(`确定删除脚本「${script.name}」吗？`, '删除脚本', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning',
      confirmButtonClass: 'el-button--danger',
    });
  } catch {
    return;
  }

  deletingScriptId.value = script.id;
  const wasCurrent = selectedScriptId.value === script.id;
  try {
    await deleteAppiumScript(script.id);
    await loadScripts();
    if (wasCurrent) {
      resetCurrentScript();
    }
    ElMessage.success('脚本已删除');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '删除脚本失败');
  } finally {
    deletingScriptId.value = '';
  }
}

async function downloadScript(script: AppiumRecordedScript) {
  if (downloadingScriptId.value) return;
  downloadingScriptId.value = script.id;
  try {
    const { blob, fileName } = await downloadAppiumScript(script.id);
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '导出脚本失败');
  } finally {
    downloadingScriptId.value = '';
  }
}

function chooseScriptImportFile() {
  scriptImportInput.value?.click();
}

async function importScriptFile(event: Event) {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  importingScript.value = true;
  try {
    const payload = JSON.parse(await file.text()) as unknown;
    const result = await importAppiumScript(payload);
    await loadScripts();
    loadScript(result.script);
    ElMessage.success(`脚本「${result.script.name}」已导入`);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '导入脚本失败');
  } finally {
    importingScript.value = false;
  }
}

async function saveScript() {
  if (!ensureAppPackageSelected()) return false;
  const wasNew = !selectedScriptId.value;
  saving.value = true;
  try {
    validateVariables(scriptVariables.value);
    const payload = await saveAppiumScript({
      id: selectedScriptId.value || undefined,
      name: form.name,
      appPackage: form.appPackage,
      appActivity: form.appActivity,
      deviceId: selectedDeviceId.value,
      steps: steps.value,
      variables: scriptVariables.value,
    });
    await loadScripts();
    selectedScriptId.value = payload.script.id;
    if (wasNew) void saveVariables('/api/appium-recorder/variables?draft=1', []).catch(() => ElMessage.error('变量草稿清理失败'));
    markDraftSaved();
    ElMessage.success('Appium 脚本已保存');
    return true;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败');
    return false;
  } finally {
    saving.value = false;
  }
}

async function replayScript() {
  if (preparingReplay.value || replaying.value) return;
  if (!selectedScript.value) {
    ElMessage.warning('请选择已保存脚本');
    return;
  }
  if (hasUnsavedChanges.value) {
    const saved = await saveScript();
    if (!saved || !selectedScript.value) return;
  }
  let reportSummaryEnabled = false;
  let reportSummaryPrompt: string | undefined;
  if (props.reportSummary?.enabled) {
    preparingReplay.value = true;
    try {
      const status = await checkReportSummaryModel();
      if (status.available) {
        reportSummaryEnabled = true;
        reportSummaryPrompt = selectedReportTemplate.value?.prompt || DEFAULT_REPORT_SUMMARY_PROMPT;
      } else {
        await ElMessageBox.alert(
          `当前提示词优化模型不可用${status.message ? `：${status.message}` : ''}。本次将跳过 AI 总结并生成默认格式的基础报告。`,
          '回放报告总结不可用',
          { type: 'warning', confirmButtonText: '继续回放' },
        ).catch(() => {});
      }
    } catch (error) {
      await ElMessageBox.alert(
        `无法检测提示词优化模型：${error instanceof Error ? error.message : '未知错误'}。本次将跳过 AI 总结并生成默认格式的基础报告。`,
        '回放报告总结不可用',
        { type: 'warning', confirmButtonText: '继续回放' },
      ).catch(() => {});
    } finally {
      preparingReplay.value = false;
    }
  }
  replaying.value = true;
  stoppingReplay.value = false;
  activeReplayDeviceId.value = selectedDeviceId.value;
  replayOutput.value = '';
  try {
    await pauseAutoTreeRefresh();
    const result = await replayAppiumScript(
      {
        id: selectedScript.value.id,
        deviceId: activeReplayDeviceId.value,
        recordVideo: recordReplayVideo.value,
        reportSummaryEnabled,
        reportSummaryPrompt,
      },
      (line) => {
        replayOutput.value += `${replayOutput.value ? '\n' : ''}${line}`;
      },
    );
    replayOutput.value = result.output || '';
    if (result.stopped) {
      ElMessage.info('回放已终止，报告、日志和截图回放已生成');
    } else if (result.softFailureCount) {
      ElMessage.warning(`回放完成，但存在 ${result.softFailureCount} 个视觉变化未达预期节点`);
    } else if (result.success) {
      ElMessage.success('回放完成');
    } else {
      ElMessage.error('回放失败，详情见回放输出');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : '回放失败';
    replayOutput.value += `${replayOutput.value ? '\n' : ''}${message}`;
    ElMessage.error('回放失败，详情见回放输出');
  } finally {
    replaying.value = false;
    stoppingReplay.value = false;
    activeReplayDeviceId.value = '';
    scheduleAutoTreeRefresh(800);
  }
}

async function stopReplay() {
  if (!replaying.value || stoppingReplay.value) return;
  stoppingReplay.value = true;
  try {
    const result = await stopAppiumReplay(activeReplayDeviceId.value);
    if (result.stopped) {
      ElMessage.info('正在终止回放并生成报告、日志和截图回放');
    } else {
      stoppingReplay.value = false;
      ElMessage.warning('当前没有可终止的回放任务');
    }
  } catch (error) {
    stoppingReplay.value = false;
    ElMessage.error(error instanceof Error ? error.message : '终止回放失败');
  }
}

onMounted(() => {
  window.addEventListener('beforeunload', warnBeforeUnload);
  void loadScripts();
});

onUnmounted(() => {
  window.removeEventListener('beforeunload', warnBeforeUnload);
  stopAutoTreeRefresh();
});

watch(() => form.appPackage, (packageName) => {
  if (!packageName) return;
  steps.value = steps.value.map((step) => (
    step.type === 'launchApp'
      ? { ...step, label: `启动 APP ${packageName}`, value: packageName }
      : step.type === 'clearAppData'
        ? { ...step, label: `清理 APP 缓存（含数据）${packageName}`, value: packageName }
        : step
  ));
});

watch(
  () => [props.active, props.playgroundDeviceId] as const,
  ([active, deviceId]) => {
    stopAutoTreeRefresh();
    if (active && deviceId) {
      void refreshTree().finally(() => scheduleAutoTreeRefresh());
    }
  },
  { immediate: true },
);
</script>

<template>
  <section class="appium-recorder-page">
    <Teleport to="#appium-header-actions">
    <div v-if="active" class="appium-header-actions">
      <el-select
        v-model="selectedScriptId"
        clearable
        placeholder="选择脚本"
        class="appium-header-actions__script"
        @change="loadSelectedScript"
      >
        <el-option v-for="script in scripts" :key="script.id" :label="script.name" :value="script.id" />
      </el-select>
      <el-button :icon="Plus" :disabled="newScriptDisabled || newScriptDialogVisible" @click="requestNewScript">新建</el-button>
      <el-button :icon="Check" :loading="saving" @click="saveScript">保存</el-button>
      <el-button-group class="replay-button-group">
        <el-button
          type="primary"
          :icon="VideoPlay"
          :loading="replaying || preparingReplay"
          :disabled="!selectedScript"
          @click="replayScript"
        >
          回放
        </el-button>
        <el-popover trigger="click" placement="bottom" :width="320">
          <template #reference><el-button type="primary" :icon="ArrowDown" :disabled="replaying || preparingReplay" aria-label="回放设置" title="回放设置" class="replay-settings-toggle" /></template>
          <div class="replay-settings-panel">
            <el-tooltip content="使用内置服务端后台录制，无需安装 scrcpy 或 FFmpeg。含敏感变量的运行不录制；分享 HTML 报告时需同时携带 MP4。" placement="bottom" :show-after="300">
              <el-checkbox v-model="recordReplayVideo" :disabled="replaying || preparingReplay">录制回放视频</el-checkbox>
            </el-tooltip>
            <div class="replay-report-template">
              <span>报告模板</span>
              <el-select v-model="selectedReportTemplateName" clearable :disabled="replaying || preparingReplay || !reportSummary?.enabled" placeholder="默认测试报告（未选择时使用）">
                <el-option v-for="template in availableReportTemplates" :key="template.name" :label="template.name" :value="template.name" />
              </el-select>
              <small v-if="!reportSummary?.enabled">需先在参数配置中开启回放报告总结。</small>
            </div>
          </div>
        </el-popover>
      </el-button-group>
      <el-button
        v-if="replaying"
        type="danger"
        :icon="CircleClose"
        :loading="stoppingReplay"
        @click="stopReplay"
      >
        终止
      </el-button>
    </div>

    </Teleport>

    <RecorderWorkspace ref="workspaceRef">
      <template #preview>
      <DevicePreviewPanel
        compact
        :interaction-disabled="recordingBusy || replaying"
        :available="playgroundAvailable"
        :devices="androidDevices"
        :selected-device-id="selectedDeviceId"
        :frame-url="playgroundFrameUrl"
        :image-url="devicePreviewUrl"
        :preview-error="playgroundPreviewError"
        :actions="deviceActions"
        :overlay-bounds="overlayBounds"
        :selected-bounds="selectedBounds"
        :selected-region="visualChangeSelectedRegion"
        :region-selection="visualChangeRegionSelectionEnabled"
        :point-selection="pickingCoordinate"
        @cancel-point-selection="coordinatePicker.cancel()"
        :region-draw-mode="visualChangePicking || imageCheckPicking"
        :device-width="deviceWidth"
        :device-height="deviceHeight"
        @switch-device="switchDevice"
        @trigger-key="triggerDeviceKey"
        @refresh-preview="refreshDevicePreview"
        @tap="selectNodeFromPoint"
        @region-select="applyVisualChangeRegion"
        @swipe="swipePreview"
      />
      </template>
      <template #tree>
        <ComponentInspector :tree="tree" :node="selectedNode" :activity="currentActivity" :loading="loadingTree" :disabled="replaying" :recording="recordingTap" @refresh="refreshTree" @select="selectedNode = $event" />
      </template>

      <el-card shadow="never" class="appium-recorder-card appium-recorder-card--workbench">
        <el-tabs
          :model-value="activeWorkbenchTab"
          class="appium-workbench-tabs"
          @tab-click="setActiveWorkbenchTab($event.paneName)"
        >
          <el-tab-pane label="当前录制" name="recording">
            <div class="appium-workbench">
              <section class="appium-workbench__section">
                <h3>节点与脚本</h3>
                <div class="appium-side-form">
                  <el-input v-model="form.name" placeholder="脚本名称" />
                  <el-select
                    v-model="form.appPackage"
                    filterable
                    placeholder="选择预设 App 参数"
                  >
                    <el-option
                      v-for="app in appPresets"
                      :key="app.id"
                      :label="`${app.name} · ${app.packageName}`"
                      :value="app.packageName"
                    />
                  </el-select>
                </div>
              </section>

              <section class="appium-workbench__section appium-workbench__flow">
                <RecordedSteps
                  :key="newScriptRevision"
                  :ai-recognition-model-configured="aiRecognitionModelConfigured"
                  :steps="steps"
                  :clipboard-count="flowClipboardCount"
                  :disabled="recordingLocked"
                  :remove-disabled="recordingLocked"
                  :merge-disabled="recordingBusy || replaying || saving"
                  :launching-step-id="executingAppStepId"
                  @remove="removeStep"
                  @copy="copyFlowNodes"
                  @paste="pasteFlowNodes"
                  @add-delay="addDelayStep"
                  @insert-action="(index, action, beforeStepId) => addSharedAction(action, index, beforeStepId)"
                  @insert-branch-action="addBranchAction"
                  @edit-input="editInputStep"
                  @preview-linked-script="previewLinkedScriptStep"
                  @execute-step="executeFlowStep"
                  @update-step="updateStep"
                  @replace-steps="!recordingBusy && !replaying && !saving && (steps = $event)"
                />
              </section>

            </div>
          </el-tab-pane>

          <el-tab-pane label="脚本列表" name="scripts">
            <div class="appium-script-list">
              <div class="appium-script-list__toolbar">
                <el-tooltip content="导入脚本" placement="top" :show-after="200"><span class="appium-script-icon">
                  <el-button size="small" :icon="Upload" aria-label="导入脚本" :loading="importingScript" @click="chooseScriptImportFile" />
                </span></el-tooltip>
                <input
                  ref="scriptImportInput"
                  class="appium-script-list__file-input"
                  type="file"
                  accept="application/json,.json"
                  @change="importScriptFile"
                >
              </div>
              <el-empty v-if="!scripts.length" description="暂无录制脚本" />
              <template v-else>
                <article
                  v-for="script in scripts"
                  :key="script.id"
                  class="appium-script-list__item"
                  :class="{ 'appium-script-list__item--active': script.id === selectedScriptId }"
                >
                  <div class="appium-script-list__main">
                    <strong>{{ script.name }}</strong>
                    <span>{{ script.appPackage }}</span>
                    <small>{{ script.steps.length }} 步 · {{ formatScriptTime(script.updatedAt) }}</small>
                  </div>
                  <div class="appium-script-list__actions">
                    <el-tooltip content="历史结果对比" placement="top" :show-after="200"><span class="appium-script-icon">
                      <el-button size="small" :icon="Clock" aria-label="历史结果对比" @click.stop="historyScript = { id: script.id, name: script.name }" />
                    </span></el-tooltip>
                    <el-tooltip content="加载" placement="top" :show-after="200"><span class="appium-script-icon">
                      <el-button size="small" :icon="Document" aria-label="加载" @click.stop="loadScript(script)" />
                    </span></el-tooltip>
                    <el-tooltip content="修改脚本名称" placement="top" :show-after="200"><span class="appium-script-icon">
                    <el-button
                      size="small"
                      :icon="Edit"
                      :loading="renamingScriptId === script.id"
                      aria-label="修改脚本名称"
                      @click.stop="renameScript(script)"
                    />
                    </span></el-tooltip>
                    <el-tooltip content="复制脚本" placement="top" :show-after="200"><span class="appium-script-icon">
                    <el-button
                      size="small"
                      :icon="CopyDocument"
                      :loading="duplicatingScriptId === script.id"
                      aria-label="复制脚本"
                      @click.stop="duplicateScript(script)"
                    />
                    </span></el-tooltip>
                    <el-tooltip content="下载脚本" placement="top" :show-after="200"><span class="appium-script-icon">
                    <el-button
                      size="small"
                      :icon="Download"
                      :loading="downloadingScriptId === script.id"
                      :disabled="Boolean(downloadingScriptId) && downloadingScriptId !== script.id"
                      aria-label="下载脚本"
                      @click.stop="downloadScript(script)"
                    />
                    </span></el-tooltip>
                    <el-tooltip content="删除脚本" placement="top" :show-after="200"><span class="appium-script-icon">
                    <el-button
                      size="small"
                      type="danger"
                      :icon="Delete"
                      :loading="deletingScriptId === script.id"
                      aria-label="删除脚本"
                      @click.stop="removeScript(script)"
                    />
                    </span></el-tooltip>
                  </div>
                </article>
              </template>
            </div>
          </el-tab-pane>
          <el-tab-pane label="预设变量" name="variables" lazy>
            <PresetVariables :key="`${selectedScriptId}:${newScriptRevision}`" v-model:variables="scriptVariables" :script-id="selectedScriptId" :script-name="form.name" :disabled="recordingBusy || saving" @saved="onVariablesSaved" />
          </el-tab-pane>
        </el-tabs>
      </el-card>
    </RecorderWorkspace>

    <RunHistoryDialog v-if="historyScript" :script-id="historyScript.id" :script-name="historyScript.name" @close="historyScript = null" />
    <NewScriptDialog
      v-if="newScriptDialogVisible"
      :script-name="form.name"
      :saving="saving"
      @save="saveAndNewScript"
      @discard="startNewScript"
      @cancel="newScriptDialogVisible = false"
    />


    <AiRecognitionTestDialog v-if="aiRecognitionTestStep" :step="aiRecognitionTestStep" :device-id="selectedDeviceId" :model-configured="Boolean(aiRecognitionModelConfigured)" @close="aiRecognitionTestStep = null" />
    <ImageCheckDialog
      v-if="imageCheckDraft?.imageCheck"
      :timeout-branch="imageCheckDraft.timeoutBranch"
      @timeout-branch="imageCheckDraft = { ...imageCheckDraft!, timeoutBranch: $event }"
      :config="imageCheckDraft.imageCheck" :device-id="selectedDeviceId"
      :has-element="Boolean(selectedNode?.bounds)" :editing="imageCheckEditing" :picking="imageCheckPicking"
      @update="updateImageCheck" @close="imageCheckDraft = null; imageCheckPicking = false"
      @confirm="confirmImageCheck" @use-element="useImageCheckElement"
      @pick="imageCheckPicking = true; workspaceRef?.showPreview()"
    />
    <VisualChangeDialog
      :model-value="visualChangeDialogVisible"
      :config="visualChangeConfig"
      :has-selected-element="Boolean(selectedNode?.bounds)"
      :picking-region="visualChangePicking"
      @update:model-value="$event ? (visualChangeDialogVisible = true) : closeVisualChangeDialog()"
      @update:config="updateVisualChangeConfig"
      @pick-region="pickVisualChangeRegion"
      @confirm="confirmVisualChangeStep"
    />

    <el-dialog
      :model-value="Boolean(pendingNavigation)"
      title="检测到 Activity 跳转"
      width="560px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="false"
    >
      <div class="appium-navigation-dialog">
        <p>检测到 Activity 已跳转。可以继续在当前脚本中录制后续操作，或保存当前脚本并开始录制新页面。</p>
        <dl>
          <div>
            <dt>点击前</dt>
            <dd>{{ pendingNavigation?.beforeActivity || '-' }}</dd>
          </div>
          <div>
            <dt>点击后</dt>
            <dd>{{ pendingNavigation?.afterActivity || '-' }}</dd>
          </div>
        </dl>
      </div>
      <template #footer>
        <div class="appium-navigation-footer">
          <el-button :disabled="resolvingNavigation" @click="continueOnActivityChange">继续录制</el-button>
          <el-button type="primary" :loading="resolvingNavigation" @click="saveOnActivityChange">保存脚本</el-button>
        </div>
      </template>
    </el-dialog>

    <el-dialog
      v-model="linkedScriptDialogVisible"
      title="连接脚本"
      width="520px"
      align-center
      @closed="closeLinkedScriptDialog"
    >
      <el-form label-position="top">
        <el-form-item :label="linkedScriptBranchTarget ? '分支录制 Activity' : '插入点 Activity'">
          <code class="appium-linked-script-activity">{{ linkedScriptExpectedActivity || '-' }}</code>
        </el-form-item>
        <el-form-item label="选择同一 App 的脚本">
          <div class="appium-linked-script-picker">
            <el-select
              v-model="linkedScriptTargetId"
              filterable
              placeholder="选择要连接的脚本"
              class="appium-linked-script-select"
            >
              <el-option
                v-for="script in compatibleLinkableScripts"
                :key="script.id"
                :label="`${script.name} · ${script.appActivity || '未绑定 Activity'} · ${script.steps.length} 步`"
                :value="script.id"
              />
            </el-select>
            <el-button
              :icon="View"
              :disabled="!linkedScriptTarget"
              @click="openLinkedScriptPreview()"
            >
              预览
            </el-button>
          </div>
        </el-form-item>
        <el-alert v-if="linkedScriptTarget" :closable="false" type="info" show-icon
          :title="linkedScriptTarget.appActivity
            ? `回放时等待进入 ${linkedScriptTarget.appActivity}，请在前序步骤中完成页面跳转。`
            : '此脚本未绑定入口 Activity，将直接从当前画面执行。请确保前序步骤已进入目标页面。'"
        />
        <ScriptParameterSettings :step="linkedParameters" @update="Object.assign(linkedParameters, $event)" />
      </el-form>
      <template #footer>
        <el-button @click="closeLinkedScriptDialog">取消</el-button>
        <el-button type="primary" @click="addLinkedScriptStep">{{ linkedScriptEditingId ? '保存' : '添加连接' }}</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="linkedScriptPreviewVisible"
      :title="linkedScriptPreviewScript ? `预览脚本：${linkedScriptPreviewScript.name}` : '预览脚本'"
      width="86vw"
      top="6vh"
      class="appium-linked-script-preview-dialog"
      :z-index="4000"
      append-to-body
    >
      <template v-if="linkedScriptPreviewScript">
        <div class="appium-linked-script-preview-meta">
          <strong>{{ linkedScriptPreviewScript.name }}</strong>
          <span>
            {{ linkedScriptPreviewScript.appPackage || '-' }}
            · {{ linkedScriptPreviewScript.appActivity || '未绑定 Activity' }}
            · {{ linkedScriptPreviewScript.steps.length }} 步
          </span>
        </div>
        <FlowCanvas
          id="appium-linked-script-preview"
          :ai-recognition-model-configured="aiRecognitionModelConfigured"
          class="appium-linked-script-preview-canvas"
          readonly
          disabled
          remove-disabled
          :steps="linkedScriptPreviewScript.steps"
          :expanded-step-index="null"
          :copy-mode="false"
          :selected-copy-indexes="readonlyFlowSelectedIndexes"
          :reset-view-token="linkedScriptPreviewResetToken"
          :start-action-groups="readonlyFlowActionGroups"
          :main-action-groups="readonlyFlowActionGroups"
          :can-open-insert-menu="false"
          :is-start-action-disabled="isReadonlyFlowActionDisabled"
          :is-insert-action-disabled="isReadonlyFlowActionDisabled"
          :is-app-execution-disabled="isReadonlyFlowAppExecutionDisabled"
          :label-step="labelFlowStep"
          :is-copy-selected="isReadonlyFlowCopySelected"
        />
      </template>
      <template #footer>
        <el-button @click="linkedScriptPreviewVisible = false">关闭</el-button>
        <el-button
          type="primary"
          :disabled="!linkedScriptPreviewScript"
          @click="loadPreviewScriptForEditing"
        >
          加载后修改
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="replayOutputDialogVisible"
      title="回放输出"
      width="820px"
      top="8vh"
      class="appium-replay-dialog"
      draggable
      overflow
    >
      <pre class="appium-replay-output appium-replay-output--dialog">{{ replayOutput }}</pre>
      <template #footer>
        <el-button :icon="CopyDocument" :disabled="!replayOutput" @click="copyReplayOutput">复制</el-button>
        <el-button :icon="Delete" :disabled="!replayOutput" @click="clearReplayOutput">清除</el-button>
        <el-button type="primary" @click="replayOutputDialogVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-tooltip v-if="active" content="查看回放输出" placement="left">
      <el-badge
        :is-dot="Boolean(replayOutput) && !replayOutputDialogVisible"
        class="appium-replay-fab"
      >
        <el-button
          type="primary"
          circle
          :icon="Document"
          :class="{ 'appium-replay-fab__button--running': replaying }"
          aria-label="查看回放输出"
          @click="replayOutputDialogVisible = true"
        />
      </el-badge>
    </el-tooltip>
  </section>
</template>

<style scoped>
.appium-script-icon { display: inline-flex; }
.appium-script-icon .el-button { width: 30px; height: 30px; min-height: 30px; padding: 0; margin: 0; }
:deep(.appium-recorder-card--workbench > .el-card__body) { overflow: hidden; }
:deep(.appium-workbench-tabs > .el-tabs__content) { overflow: hidden; }
:deep(.appium-workbench-tabs .el-tab-pane) { height: 100%; overflow: auto; }
.appium-workbench { height: 100%; box-sizing: border-box; grid-template-rows: auto minmax(0, 1fr); gap: 10px; overflow: hidden; padding: 12px; }
.appium-workbench__flow { display: flex; flex-direction: column; min-height: 0; }
.appium-workbench__flow h3 { margin-bottom: 6px; }
.appium-workbench__flow :deep(.appium-recorded-steps-panel) { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.appium-workbench__flow :deep(.appium-flow-toolbar) { flex: none; margin-bottom: 8px; }
.appium-workbench__flow :deep(.appium-flow-canvas--vue:not(.appium-flow-canvas--dialog)) { flex: 1; height: auto; min-height: 120px; }
.replay-button-group { display: inline-flex; flex-shrink: 0; }
.replay-settings-toggle { padding-inline: 8px; }
.replay-settings-panel { display: grid; gap: 14px; }
.replay-report-template { display: grid; gap: 6px; }
.replay-report-template > span { color: var(--el-text-color-regular); font-size: 13px; }
.replay-report-template small { color: var(--el-text-color-secondary); line-height: 1.5; }
</style>
