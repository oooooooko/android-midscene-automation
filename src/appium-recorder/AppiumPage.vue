<script setup lang="ts">
import { computed, h, onMounted, onUnmounted, reactive, shallowRef, watch } from 'vue';
import { ElForm, ElFormItem, ElInputNumber, ElMessage, ElMessageBox, ElOption, ElSelect } from 'element-plus';
import { Check, CircleClose, CopyDocument, Delete, Document, Download, Refresh, Upload, VideoPlay, View } from '@element-plus/icons-vue';
import type { AndroidDevice, AppPreset, DeviceAction } from '../types';
import DevicePreviewPanel from '../components/device/DevicePreviewPanel.vue';
import {
  appiumScriptDownloadUrl,
  clearAppiumDeviceAppData,
  deleteAppiumScript,
  getAppiumScripts,
  getAppiumTree,
  importAppiumScript,
  launchAppiumDeviceApp,
  replayAppiumScript,
  saveAppiumScript,
  stopAppiumReplay,
  tapAppiumDevice,
} from './api';
import ComponentTree from './components/ComponentTree.vue';
import FlowCanvas from './components/FlowCanvas.vue';
import NodeDetail from './components/NodeDetail.vue';
import RecordedSteps from './components/RecordedSteps.vue';
import {
  createFlowClipboard,
  pasteFlowClipboard,
  type FlowClipboard,
} from './flow-copy';
import { labelFlowStep } from './flow-labels';
import type { FlowActionGroup, InsertAction } from './flow-graph';
import { findSmallestNodeAtPoint, flattenNodes, parseWindowHierarchy } from './tree';
import type { AppiumNode, AppiumRecordedScript, AppiumRecordedStep } from './types';

type NodeStepType = 'tap' | 'input' | 'assertExists' | 'waitFor';
type BranchName = 'yes' | 'no';
type LegacyFlow = NonNullable<AppiumRecordedStep['flow']> & { scope?: string };
type SwipeGesture = NonNullable<AppiumRecordedStep['swipe']>;
type SwipeForm = SwipeGesture & { direction: string };
type BranchTarget = {
  stepId: string;
  branch: BranchName;
  updateTarget?: boolean;
  entryTargetId?: string;
  nextTargetId?: string;
};
type RecorderAction =
  | 'delay'
  | NodeStepType
  | 'tapIfExists'
  | 'inputIfExists'
  | 'clearIfExists'
  | 'backIfExists'
  | 'popupCondition'
  | 'runScript'
  | 'keyBack'
  | 'keyHome'
  | 'keyRecent'
  | 'keyPower'
  | 'waitActivity'
  | 'swipe'
  | 'clearInput'
  | 'coordinateTap'
  | 'launchApp'
  | 'clearAppData'
  | 'waitDisappear'
  | 'assertText'
  | 'longPress'
  | 'pinch';

const WORKBENCH_TAB_STORAGE_KEY = 'android-midscene-automation:appium-workbench-tab';
const AUTO_TREE_REFRESH_INTERVAL_MS = 1800;

const insertableRecorderActions: RecorderAction[] = [
  'delay',
  'tap',
  'input',
  'assertExists',
  'waitFor',
  'tapIfExists',
  'inputIfExists',
  'clearIfExists',
  'backIfExists',
  'popupCondition',
  'runScript',
  'keyBack',
  'keyHome',
  'keyRecent',
  'keyPower',
  'waitActivity',
  'swipe',
  'clearInput',
  'coordinateTap',
  'launchApp',
  'clearAppData',
  'waitDisappear',
  'assertText',
  'longPress',
  'pinch',
];
const readonlyFlowActionGroups: FlowActionGroup[] = [];
const readonlyFlowSelectedIndexes: number[] = [];

const props = defineProps<{
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

const selectedDeviceId = computed(() => props.playgroundDeviceId);
const tree = shallowRef<AppiumNode | null>(null);
const selectedNode = shallowRef<AppiumNode | null>(null);
const scripts = shallowRef<AppiumRecordedScript[]>([]);
const selectedScriptId = shallowRef('');
const storedWorkbenchTab = window.localStorage.getItem(WORKBENCH_TAB_STORAGE_KEY);
const activeWorkbenchTab = shallowRef<'recording' | 'scripts'>(storedWorkbenchTab === 'scripts' ? 'scripts' : 'recording');
const steps = shallowRef<AppiumRecordedStep[]>([]);
const flowClipboard = shallowRef<FlowClipboard | null>(null);
const rawXml = shallowRef('');
const currentActivity = shallowRef('');
const replayOutput = shallowRef('');
const replayOutputDialogVisible = shallowRef(false);
const linkedScriptDialogVisible = shallowRef(false);
const linkedScriptTargetId = shallowRef('');
const linkedScriptInsertIndex = shallowRef<number | undefined>();
const linkedScriptBranchTarget = shallowRef<BranchTarget | null>(null);
const linkedScriptExpectedActivity = shallowRef('');
const linkedScriptPreviewVisible = shallowRef(false);
const linkedScriptPreviewScriptId = shallowRef('');
const linkedScriptPreviewResetToken = shallowRef(0);
const loadingTree = shallowRef(false);
const saving = shallowRef(false);
const importingScript = shallowRef(false);
const scriptImportInput = shallowRef<HTMLInputElement | null>(null);
const deletingScriptId = shallowRef('');
const replaying = shallowRef(false);
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

const savedDraftSnapshot = shallowRef('');
const currentDraftSnapshot = computed(() => JSON.stringify({
  name: form.name,
  appPackage: form.appPackage,
  appActivity: form.appActivity,
  steps: steps.value,
}));
const flowClipboardCount = computed(() => flowClipboard.value?.steps.length || 0);
const hasUnsavedChanges = computed(() => currentDraftSnapshot.value !== savedDraftSnapshot.value);

function markDraftSaved() {
  savedDraftSnapshot.value = currentDraftSnapshot.value;
}

function warnBeforeUnload(event: BeforeUnloadEvent) {
  if (!props.active || !hasUnsavedChanges.value) return;
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
const compatibleLinkableScripts = computed(() => linkableScripts.value.filter((script) => (
  script.appPackage === form.appPackage
  && (
    Boolean(linkedScriptBranchTarget.value)
    || (
      Boolean(linkedScriptExpectedActivity.value)
      && script.appActivity === linkedScriptExpectedActivity.value
    )
  )
)));
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
const recordingLocked = computed(() => recordingBusy.value || scriptActivityMismatch.value);
const overlayBounds = computed(() => flattenNodes(tree.value).flatMap((node) => (
  node.bounds ? [{ id: node.id, ...node.bounds }] : []
)));
const selectedBounds = computed(() => {
  const bounds = selectedNode.value?.bounds;
  return bounds && selectedNode.value ? { id: selectedNode.value.id, ...bounds } : undefined;
});

function insertStep(step: AppiumRecordedStep, index?: number) {
  const nextSteps = [...steps.value];
  let insertedStep = step;
  if (index === -1) {
    nextSteps.unshift(insertedStep);
  } else if (typeof index === 'number') {
    const previousStep = nextSteps[index];
    const previousTargetId = previousStep?.flow?.successTargetId;
    if (previousStep && previousTargetId) {
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
    nextSteps.push(step);
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

function pasteFlowNodes(index: number, branch?: BranchName) {
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
    });
    steps.value = nextSteps;
    ElMessage.success(`已粘贴 ${flowClipboardCount.value} 个节点${branch ? `到${branch === 'yes' ? '是' : '否'}分支` : ''}`);
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

function branchContextForInsert(index: number, branch: BranchName) {
  const anchor = steps.value[index];
  if (!anchor) return undefined;
  if (anchor.flow?.parentConditionId && anchor.flow.parentBranch === branch) {
    const conditionIndex = steps.value.findIndex((step) => step.id === anchor.flow?.parentConditionId);
    const condition = conditionIndex >= 0 ? steps.value[conditionIndex] : undefined;
    return condition ? { condition, conditionIndex } : undefined;
  }
  if (anchor.flow?.nodeKind === 'condition') {
    return { condition: anchor, conditionIndex: index };
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
    assertExists: '断言存在',
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
    timeoutMs: type === 'assertExists' || type === 'waitFor' ? 10000 : undefined,
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
    timeoutMs: 10000,
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
      ElMessage.success('已进入脚本绑定页面，编辑锁定已解除');
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : 'App 操作失败');
  } finally {
    launchingApp.value = false;
    executingAppStepId.value = '';
  }
}

function selectNodeFromPoint(point: { x: number; y: number }) {
  const node = findSmallestNodeAtPoint(tree.value, point.x, point.y);
  if (node) {
    selectedNode.value = node;
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

async function recordTapStep(index?: number) {
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
  insertStep(step, index);
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

async function addStep(type: NodeStepType, index?: number) {
  if (recordingBusy.value) return;
  if (!selectedNode.value) return;
  if (!ensureAppPackageSelected()) return;
  if (type === 'tap') {
    return recordTapStep(index);
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
  return insertStep(step, index);
}

async function addDelayStep(index?: number) {
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
  return insertStep(step, index);
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

async function addSwipeStep(index?: number) {
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
  }), index);
}

function openLinkedScriptDialog(index?: number, branchTarget?: BranchTarget) {
  if (!linkableScripts.value.length) {
    ElMessage.warning('暂无可连接的已保存脚本');
    return;
  }
  linkedScriptBranchTarget.value = branchTarget || null;
  linkedScriptExpectedActivity.value = expectedActivityAfterStep(index);
  if (!linkedScriptBranchTarget.value && !linkedScriptExpectedActivity.value) {
    ElMessage.warning('无法确定当前插入点的 Activity，请先刷新组件树');
    return;
  }
  if (!compatibleLinkableScripts.value.length) {
    ElMessage.warning(
      linkedScriptBranchTarget.value
        ? '没有属于当前 App 的可连接脚本'
        : `没有入口 Activity 为 ${linkedScriptExpectedActivity.value} 的可连接脚本`,
    );
    linkedScriptExpectedActivity.value = '';
    linkedScriptBranchTarget.value = null;
    return;
  }
  linkedScriptTargetId.value = compatibleLinkableScripts.value[0]?.id || '';
  linkedScriptInsertIndex.value = index;
  linkedScriptDialogVisible.value = true;
}

function addLinkedScriptStep() {
  const script = scripts.value.find((item) => item.id === linkedScriptTargetId.value);
  if (!script) {
    ElMessage.warning('请选择要连接的脚本');
    return;
  }
  if (script.appPackage !== form.appPackage) {
    ElMessage.error('连接脚本必须属于当前 App');
    return;
  }
  if (
    !linkedScriptBranchTarget.value
    && (!linkedScriptExpectedActivity.value || script.appActivity !== linkedScriptExpectedActivity.value)
  ) {
    ElMessage.error(
      `无法连接：插入点 Activity 为 ${linkedScriptExpectedActivity.value || '-'}，`
      + `目标脚本入口 Activity 为 ${script.appActivity || '-'}`,
    );
    return;
  }
  const step = insertStep(createRunScriptStep(script), linkedScriptInsertIndex.value);
  if (linkedScriptBranchTarget.value) {
    attachStepToBranch(step.id, linkedScriptBranchTarget.value.stepId, linkedScriptBranchTarget.value.branch);
    if (linkedScriptBranchTarget.value.nextTargetId) {
      steps.value = steps.value.map((item) => (
        item.id === step.id
          ? {
              ...item,
              flow: {
                ...(item.flow || {}),
                successTargetId: linkedScriptBranchTarget.value?.nextTargetId,
              },
            }
          : item
      ));
    }
    if (linkedScriptBranchTarget.value.updateTarget) {
      updateBranchTarget(
        linkedScriptBranchTarget.value.stepId,
        linkedScriptBranchTarget.value.branch,
        linkedScriptBranchTarget.value.entryTargetId || step.id,
      );
    }
  }
  linkedScriptInsertIndex.value = undefined;
  linkedScriptBranchTarget.value = null;
  linkedScriptExpectedActivity.value = '';
  linkedScriptDialogVisible.value = false;
  ElMessage.success('已添加连接脚本步骤');
}

function closeLinkedScriptDialog() {
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

function isReadonlyFlowActionDisabled(_action: InsertAction) {
  return true;
}

function isReadonlyFlowAppExecutionDisabled(_action: 'launchApp' | 'clearAppData') {
  return true;
}

function isReadonlyFlowCopySelected(_index: number) {
  return false;
}

async function addAction(
  action: RecorderAction,
  index?: number,
  branchTarget?: BranchTarget,
) {
  if (recordingBusy.value) return;
  if (!ensureAppPackageSelected()) return;
  if (action === 'launchApp' && steps.value.some((step) => step.type === 'launchApp')) {
    ElMessage.warning('启动 APP 节点只能添加一个');
    return;
  }
  if (action === 'clearAppData' && steps.value.some((step) => step.type === 'clearAppData')) {
    ElMessage.warning('清理 App 缓存节点只能添加一个');
    return;
  }
  if ((action === 'launchApp' || action === 'clearAppData') && index !== -1) {
    ElMessage.warning(`${action === 'launchApp' ? '启动 APP' : '清理 App 缓存'}只能从开始节点添加`);
    return;
  }
  if (action === 'runScript') {
    openLinkedScriptDialog(index, branchTarget);
    return;
  }
  if (action === 'delay') {
    return addDelayStep(index);
  }
  if (action === 'tap' || action === 'input' || action === 'assertExists' || action === 'waitFor') {
    return addStep(action, index);
  }
  if (action === 'keyBack') {
    return insertStep(createKeyStep(4, '系统返回'), index);
  }
  if (action === 'keyHome') {
    return insertStep(createKeyStep(3, 'Home 键'), index);
  }
  if (action === 'keyRecent') {
    return insertStep(createKeyStep(187, '最近任务'), index);
  }
  if (action === 'keyPower') {
    return insertStep(createKeyStep(26, '电源键'), index);
  }
  if (action === 'waitActivity') {
    const input = await ElMessageBox.prompt('请输入目标 Activity', '等待 Activity', {
      inputValue: currentActivity.value,
      confirmButtonText: '添加',
      cancelButtonText: '取消',
    }).catch(() => null);
    if (input?.value) return insertStep(createWaitActivityStep(input.value), index);
    return;
  }
  if (action === 'swipe') {
    return addSwipeStep(index);
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
    }, index);
  }
  if (action === 'launchApp') {
    const clearStepIndex = steps.value.findIndex((step) => step.type === 'clearAppData');
    return insertStep({
      id: `step_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'launchApp',
      label: `启动 APP ${form.appPackage}`,
      value: form.appPackage,
    }, clearStepIndex >= 0 ? clearStepIndex : index);
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
  if (action === 'popupCondition') {
    const step = createNodeActionStep('assertExists', '判断存在', node, { timeoutMs: 2000 });
    const inserted = insertStep({ ...step, flow: { nodeKind: 'condition' } }, index);
    ElMessage.success('已添加判断节点，请在节点面板配置是/否分支');
    return inserted;
  }
  if (action === 'tapIfExists') {
    return insertStep(createNodeActionStep('tapIfExists', '存在则点击', node, { timeoutMs: 2000 }), index);
  }
  if (action === 'inputIfExists') {
    const input = await ElMessageBox.prompt('', '存在则输入', {
      inputValue: '',
      confirmButtonText: '添加',
      cancelButtonText: '取消',
      center: true,
    }).catch(() => null);
    if (!input) return;
    return insertStep(createNodeActionStep('inputIfExists', '存在则输入', node, { timeoutMs: 2000, value: input.value }), index);
  }
  if (action === 'clearIfExists') {
    return insertStep(createNodeActionStep('clearIfExists', '存在则清空', node, { timeoutMs: 2000 }), index);
  }
  if (action === 'backIfExists') {
    return insertStep(createNodeActionStep('backIfExists', '存在则返回', node, { timeoutMs: 2000 }), index);
  }
  if (action === 'clearInput') {
    return insertStep(createNodeActionStep('clearInput', '清空输入', node), index);
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
    }, index);
  }
  if (action === 'longPress') {
    if (!node.bounds) {
      ElMessage.warning('当前组件没有可长按坐标');
      return;
    }
    const input = await ElMessageBox.prompt('请输入长按时间（毫秒）', '添加长按', {
      inputValue: '800',
      inputPattern: /^[1-9]\d*$/,
      inputErrorMessage: '请输入大于 0 的整数',
      confirmButtonText: '添加',
      cancelButtonText: '取消',
    }).catch(() => null);
    if (!input?.value) return;
    const duration = Math.max(80, Math.round(Number(input.value) || 800));
    return insertStep({
      id: `step_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      type: 'longPress',
      label: `长按 ${node.label}`,
      fallback: { strategy: 'bounds', centerX: node.bounds.centerX, centerY: node.bounds.centerY },
      timeoutMs: duration,
    }, index);
  }
  if (action === 'waitDisappear') {
    return insertStep(createNodeActionStep('waitDisappear', '等待元素消失', node, { timeoutMs: 10000 }), index);
  }
  if (action === 'assertText') {
    const input = await ElMessageBox.prompt('请输入要断言的文本', '断言文本', {
      inputValue: node.text,
      confirmButtonText: '添加',
      cancelButtonText: '取消',
    }).catch(() => null);
    if (input?.value) return insertStep(createNodeActionStep('assertText', '断言文本', node, { value: input.value }), index);
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
  const inserted = await addAction(action, insertIndex, {
    stepId: condition.id,
    branch,
    updateTarget: insertAtBranchEntry || !currentTargetId || !targetIsBranchStep,
    entryTargetId: insertAtBranchEntry ? undefined : existingBranchSteps[0]?.id,
    nextTargetId,
  });
  if (!inserted) return;
  attachStepToBranch(inserted.id, condition.id, branch);
  if (nextTargetId) {
    steps.value = steps.value.map((step) => (
      step.id === inserted.id
        ? {
            ...step,
            flow: { ...(step.flow || {}), successTargetId: nextTargetId },
          }
        : step
    ));
  }
  if (insertAtBranchEntry || !currentTargetId || !targetIsBranchStep) {
    updateBranchTarget(condition.id, branch, insertAtBranchEntry ? inserted.id : existingBranchSteps[0]?.id || inserted.id);
  }
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
      appActivity: pending.beforeActivity || form.appActivity,
      deviceId: selectedDeviceId.value,
      steps: steps.value,
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
  const removed = steps.value[index];
  if (!removed) return;
  const nextBranchStep = removed.flow?.parentConditionId && removed.flow.parentBranch
    ? steps.value.slice(index + 1).find((step) => (
        step.flow?.parentConditionId === removed.flow?.parentConditionId
        && step.flow?.parentBranch === removed.flow?.parentBranch
      ))
    : undefined;
  const replacementId = removed.flow?.parentConditionId
    ? nextBranchStep?.id || ''
    : steps.value[index + 1]?.id || '';
  steps.value = steps.value
    .filter((_step, stepIndex) => stepIndex !== index)
    .map((step) => {
      if (!step.flow) return step;
      const flow = { ...step.flow };
      let changed = false;
      (['yesTargetId', 'noTargetId', 'successTargetId', 'failureTargetId'] as const).forEach((key) => {
        if (flow[key] !== removed.id) return;
        flow[key] = replacementId;
        changed = true;
      });
      if (flow.parentConditionId === removed.id) {
        delete flow.parentConditionId;
        delete flow.parentBranch;
        changed = true;
      }
      return changed ? { ...step, flow } : step;
    });
}

function updateStep(index: number, step: AppiumRecordedStep) {
  if (recordingLocked.value) return;
  const nextSteps = [...steps.value];
  nextSteps[index] = step;
  steps.value = nextSteps;
}

async function editInputStep(index: number) {
  const step = steps.value[index];
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
  const nextTab = tab === 'scripts' ? 'scripts' : 'recording';
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
  if (script.deviceId && script.deviceId !== selectedDeviceId.value) {
    void switchDevice(script.deviceId);
  }
  steps.value = (script.steps || []).map(normalizeLegacyFlowScope);
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
  flowClipboard.value = null;
  selectedScriptId.value = '';
  form.name = '';
  form.appActivity = '';
  steps.value = [];
  replayOutput.value = '';
  markDraftSaved();
}

function formatScriptTime(value: string) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
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

function downloadScript(script: AppiumRecordedScript) {
  const link = document.createElement('a');
  link.href = appiumScriptDownloadUrl(script.id);
  link.download = `${script.name}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
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
  if (!ensureAppPackageSelected()) return;
  saving.value = true;
  try {
    const payload = await saveAppiumScript({
      id: selectedScriptId.value || undefined,
      name: form.name,
      appPackage: form.appPackage,
      appActivity: form.appActivity,
      deviceId: selectedDeviceId.value,
      steps: steps.value,
    });
    await loadScripts();
    selectedScriptId.value = payload.script.id;
    markDraftSaved();
    ElMessage.success('Appium 脚本已保存');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败');
  } finally {
    saving.value = false;
  }
}

async function replayScript() {
  if (!selectedScript.value) {
    ElMessage.warning('请选择已保存脚本');
    return;
  }
  replaying.value = true;
  stoppingReplay.value = false;
  activeReplayDeviceId.value = selectedDeviceId.value;
  replayOutput.value = '';
  try {
    await pauseAutoTreeRefresh();
    const result = await replayAppiumScript(
      { id: selectedScript.value.id, deviceId: activeReplayDeviceId.value },
      (line) => {
        replayOutput.value += `${replayOutput.value ? '\n' : ''}${line}`;
      },
    );
    replayOutput.value = result.output || '';
    if (result.stopped) {
      ElMessage.info('回放已终止，报告、日志和截图回放已生成');
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
      <el-button :icon="Check" :loading="saving" @click="saveScript">保存</el-button>
      <el-button
        type="primary"
        :icon="VideoPlay"
        :loading="replaying"
        :disabled="!selectedScript"
        @click="replayScript"
      >
        回放
      </el-button>
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

    <div class="appium-recorder-layout">
      <DevicePreviewPanel
        :available="playgroundAvailable"
        :devices="androidDevices"
        :selected-device-id="selectedDeviceId"
        :frame-url="playgroundFrameUrl"
        :image-url="devicePreviewUrl"
        :preview-error="playgroundPreviewError"
        :actions="deviceActions"
        :overlay-bounds="overlayBounds"
        :selected-bounds="selectedBounds"
        :device-width="deviceWidth"
        :device-height="deviceHeight"
        @switch-device="switchDevice"
        @trigger-key="triggerDeviceKey"
        @refresh-preview="refreshDevicePreview"
        @tap="selectNodeFromPoint"
        @swipe="swipePreview"
      />

      <el-card shadow="never" class="appium-recorder-card">
        <template #header>
          <div class="panel-header">
            <span>App 组件树</span>
            <el-button :icon="Refresh" :loading="loadingTree" :disabled="replaying" @click="refreshTree">
              刷新组件树
            </el-button>
          </div>
        </template>
        <div class="appium-tree-panel">
          <ComponentTree :tree="tree" :selected-id="selectedNode?.id || ''" @select="selectedNode = $event" />
          <div class="appium-current-activity">
            <span>当前 Activity</span>
            <code>{{ currentActivity || '-' }}</code>
          </div>
        </div>
      </el-card>

      <el-card shadow="never" class="appium-recorder-card appium-recorder-card--workbench">
        <template #header>录制与脚本</template>
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
                <el-alert
                  v-if="scriptActivityMismatch"
                  class="appium-activity-lock-alert"
                  title="当前脚本已锁定"
                  type="warning"
                  show-icon
                  :closable="false"
                >
                  <div class="appium-activity-lock-alert__details">
                    <div>
                      <strong>脚本绑定</strong>
                      <code>{{ selectedScript?.appActivity || '-' }}</code>
                    </div>
                    <div>
                      <strong>当前 Activity</strong>
                      <code>{{ currentActivity || '正在获取' }}</code>
                    </div>
                    <p>请在录制流程中添加或执行“启动 APP”节点；Activity 匹配后会自动解除编辑锁定。</p>
                  </div>
                </el-alert>
                <NodeDetail
                  :node="selectedNode"
                  :current-activity="currentActivity"
                  :loading="recordingTap"
                />
              </section>

              <section class="appium-workbench__section">
                <h3>录制步骤</h3>
                <RecordedSteps
                  :steps="steps"
                  :clipboard-count="flowClipboardCount"
                  :disabled="recordingLocked"
                  :remove-disabled="recordingBusy"
                  :allowed-locked-actions="scriptActivityMismatch && !recordingBusy ? insertableRecorderActions : []"
                  :launching-step-id="executingAppStepId"
                  @remove="removeStep"
                  @copy="copyFlowNodes"
                  @paste="pasteFlowNodes"
                  @add-delay="addDelayStep"
                  @insert-action="(index, action) => addAction(action, index)"
                  @insert-branch-action="addBranchAction"
                  @edit-input="editInputStep"
                  @preview-linked-script="previewLinkedScriptStep"
                  @execute-step="executeFlowStep"
                  @update-step="updateStep"
                />
              </section>

            </div>
          </el-tab-pane>

          <el-tab-pane label="脚本列表" name="scripts">
            <div class="appium-script-list">
              <div class="appium-script-list__toolbar">
                <el-button :icon="Upload" :loading="importingScript" @click="chooseScriptImportFile">
                  导入脚本
                </el-button>
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
                    <el-button size="small" @click.stop="loadScript(script)">加载</el-button>
                    <el-button
                      size="small"
                      :icon="Download"
                      title="下载脚本"
                      @click="downloadScript(script)"
                    />
                    <el-button
                      size="small"
                      type="danger"
                      :icon="Delete"
                      :loading="deletingScriptId === script.id"
                      @click="removeScript(script)"
                    />
                  </div>
                </article>
              </template>
            </div>
          </el-tab-pane>
        </el-tabs>
      </el-card>
    </div>

    <el-dialog
      :model-value="Boolean(pendingNavigation)"
      title="检测到 Activity 跳转"
      width="560px"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      :show-close="false"
    >
      <div class="appium-navigation-dialog">
        <p>当前录制仅支持单个 Activity。检测到 Activity 已跳转，请先保存当前脚本。</p>
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
        <el-form-item :label="linkedScriptBranchTarget ? '选择同一 App 的脚本（回放时等待入口 Activity）' : '选择入口 Activity 匹配的脚本'">
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
      </el-form>
      <template #footer>
        <el-button @click="closeLinkedScriptDialog">取消</el-button>
        <el-button type="primary" @click="addLinkedScriptStep">添加连接</el-button>
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
