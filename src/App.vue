<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  Check,
  CopyDocument,
  Edit,
  Loading,
  Monitor,
  Operation,
  RefreshLeft,
  Setting,
  VideoPause,
  VideoPlay,
} from '@element-plus/icons-vue';
import backIcon from './assets/device-actions/back.svg';
import homeIcon from './assets/device-actions/home.svg';
import powerIcon from './assets/device-actions/power.svg';
import tasksIcon from './assets/device-actions/tasks.svg';
import volumeDownIcon from './assets/device-actions/volume-down.svg';
import volumeUpIcon from './assets/device-actions/volume-up.svg';
import { promptDocument } from './config/prompt-example';
import {
  buildScript,
  type ScriptStep,
} from './script-generator';
import {
  codexMidsceneModel,
  midsceneModelPresets,
  type MidsceneModelProvider,
  type MidsceneModelPresetKey,
} from './config/midscene-model-presets';
import * as api from './api';
import AutomationPage from './pages/AutomationPage.vue';
import AppiumPage from './appium-recorder/AppiumPage.vue';
import ConfigPage from './pages/ConfigPage.vue';
import GeneratorPage from './pages/GeneratorPage.vue';
import type {
  AndroidDevice,
  ConfigForm,
  AppPreset,
  ExecutionStep,
  GeneratorMode,
  MenuKey,
  ModelUsageRecord,
  RunScriptStreamEvent,
  SavedScript,
} from './types';

const ACTIVE_MENU_STORAGE_KEY = 'android-midscene-automation:active-menu';
const menuKeys: MenuKey[] = ['generator', 'automation', 'config', 'appium'];
const storedMenu = window.localStorage.getItem(ACTIVE_MENU_STORAGE_KEY) as MenuKey | null;
const activeMenu = ref<MenuKey>(storedMenu && menuKeys.includes(storedMenu) ? storedMenu : 'generator');
const activeGeneratorMode = ref<GeneratorMode>('ai');
const sourcePrompt = ref('');
const steps = ref<ScriptStep[]>([]);
const errorMessage = ref('');
const isGenerating = ref(false);
const isSavingModelConfig = ref(false);
const isSavingAppPreset = ref(false);
const isRunningScript = ref(false);
const isStoppingScript = ref(false);
const showGeneratedCode = ref(false);
const generatedCodeOverride = shallowRef<string | null>(null);
const generatedCodeDraft = shallowRef('');
const generatedCodeEditing = shallowRef(false);
const generatedCodeEditSaving = shallowRef(false);
const importingTestCase = shallowRef(false);
const importedTestCaseFileName = shallowRef('');
const testingModelKey = ref('');
const playgroundAvailable = ref(false);
const playgroundPreviewError = ref('');
const playgroundDeviceId = ref('');
const playgroundFrameUrl = ref('');
const playgroundFrameSignature = ref('');
const devicePreviewUrl = ref('');
const devicePreviewMode = ref<'stream' | 'screenshot' | ''>('');
const backendOffline = shallowRef(false);
const androidDevices = ref<AndroidDevice[]>([]);
const deviceInterfaceSize = reactive({ width: 0, height: 0 });
const deviceDebug = reactive({
  rawX: 0,
  rawY: 0,
  mappedX: 0,
  mappedY: 0,
  action: '',
  status: 'idle',
  message: '',
});
const selectedScriptId = ref('');
const executionLog = ref('');
const executionProcess = ref<ExecutionStep[]>([]);
const lastRunStatus = ref('');
const runStartedAt = shallowRef<number | null>(null);
const runningElapsedNow = shallowRef(0);
const savedScripts = ref<SavedScript[]>([]);
const appPresets = ref<AppPreset[]>([]);
const modelUsageRecords = ref<ModelUsageRecord[]>([]);
const modelTestStatus = reactive({
  midscene: '',
  scriptOptimizer: '',
});
const actionDialog = reactive({
  visible: false,
  title: '',
  loading: false,
  error: '',
});
const codeDialog = reactive({
  visible: false,
  title: '',
  scriptId: '',
  code: '',
  draftCode: '',
  editing: false,
  saving: false,
});
let playgroundPollTimer: number | null = null;
let appiumPreviewTimer: number | null = null;
let executionProgressTimer: number | null = null;
let scriptRunAbortController: AbortController | null = null;

const isBackendFetchError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || '');
  return error instanceof TypeError || /Failed to fetch|NetworkError|Load failed/i.test(message);
};

const stopPlaygroundPollTimer = () => {
  if (!playgroundPollTimer) return;
  window.clearInterval(playgroundPollTimer);
  playgroundPollTimer = null;
};

const form = reactive({
  promptTitle: '',
  testName: '',
  appPresetId: '',
});

const appPresetForm = reactive({
  id: '',
  name: '',
  packageName: '',
});

const configForm = reactive<ConfigForm>({
  runtime: {
    androidSdkPath: '',
    reportOutputPath: '',
  },
  midscene: {
    model: {
      provider: 'custom',
      baseUrl: '',
      apiKey: '',
      name: '',
      family: '',
    },
    env: {},
  },
  scriptOptimizer: {
    model: {
      baseUrl: '',
      apiKey: '',
      name: '',
    },
  },
});
const lastCustomMidsceneModel = reactive({
  baseUrl: '',
  apiKey: '',
  name: '',
  family: '',
});

const menuItems = [
  { key: 'generator', label: '测试脚本生成', icon: Operation },
  { key: 'automation', label: '自动化测试', icon: Monitor },
] as const;
const activeMenuLabel = computed(() => {
  if (activeMenu.value === 'appium') return 'Appium';
  if (activeMenu.value === 'config') return '参数配置';
  return menuItems.find((item) => item.key === activeMenu.value)?.label || 'Midscene';
});

const selectedAppPreset = computed(() => appPresets.value.find((item) => item.id === form.appPresetId));
const appPromptPrefix = computed(() => {
  if (!selectedAppPreset.value) return '';
  const appName = selectedAppPreset.value.name;
  const packageName = selectedAppPreset.value.packageName;
  return [
    `本流程为 ${appName} App ${form.promptTitle}。目标 App 包名为 \`${packageName}\`。`,
    `执行开始时先观察当前手机界面：如果已经在 ${appName} App 内，保持当前状态；如果不在 ${appName} App 内，使用包名 \`${packageName}\` 打开 App 并等待首屏加载完成。不要生成查找桌面图标或从最近任务中选择 App 的步骤。`,
    '',
  ].join('\n');
});
const effectiveSourcePrompt = computed(() => `${appPromptPrefix.value}${sourcePrompt.value}`.trim());
const generatedCodeFromSteps = computed(() => buildScript(form, steps.value));
const generatedCode = computed(() => generatedCodeOverride.value ?? generatedCodeFromSteps.value);
const selectedScript = computed(() => savedScripts.value.find((item) => item.id === selectedScriptId.value));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const deviceActions = [
  { key: 'power', label: '关机键', icon: powerIcon, keyCode: 26 },
  { key: 'volume-up', label: '音量+', icon: volumeUpIcon, keyCode: 24 },
  { key: 'volume-down', label: '音量-', icon: volumeDownIcon, keyCode: 25 },
  { key: 'back', label: '返回', icon: backIcon, keyCode: 4 },
  { key: 'home', label: '桌面', icon: homeIcon, keyCode: 3 },
  { key: 'tasks', label: '任务', icon: tasksIcon, keyCode: 187 },
] as const;

const selectMenu = (key: string) => {
  activeMenu.value = key as MenuKey;
};

const resetGeneratedCodeEditor = () => {
  generatedCodeOverride.value = null;
  generatedCodeDraft.value = '';
  generatedCodeEditing.value = false;
  generatedCodeEditSaving.value = false;
};

watch(activeGeneratorMode, () => {
  showGeneratedCode.value = false;
  resetGeneratedCodeEditor();
});

function formatScriptTime(value: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

async function loadSavedScripts(preferredId = selectedScriptId.value) {
  const payload = await api.getScripts();
  savedScripts.value = payload.scripts || [];
  if (preferredId && savedScripts.value.some((item) => item.id === preferredId)) {
    selectedScriptId.value = preferredId;
    return;
  }
  selectedScriptId.value = savedScripts.value[0]?.id || '';
}

async function migrateLegacySavedScripts() {
  const raw = localStorage.getItem('midscene-saved-scripts');
  if (!raw) return;

  const legacyScripts = JSON.parse(raw) as Array<Partial<SavedScript>>;
  if (!legacyScripts.length) return;

  const currentPayload = await api.getScripts();
  if (currentPayload.scripts?.length) return;

  for (const item of legacyScripts) {
    if (!item.name || !item.code) continue;
    await api.saveScript({
      scriptName: item.name,
      promptTitle: item.promptTitle || item.name,
      sourcePrompt: item.sourcePrompt || '',
      code: item.code,
      steps: item.steps || [],
    });
  }

  localStorage.removeItem('midscene-saved-scripts');
}

const openActionDialog = (title: string) => {
  actionDialog.visible = true;
  actionDialog.title = title;
  actionDialog.loading = true;
  actionDialog.error = '';
};

const closeActionDialog = () => {
  actionDialog.visible = false;
  actionDialog.loading = false;
  actionDialog.error = '';
};

const openCodeDialog = (script: SavedScript) => {
  codeDialog.title = `${script.promptTitle || script.name} · ${script.name}`;
  codeDialog.scriptId = script.id;
  codeDialog.code = script.code || '';
  codeDialog.draftCode = script.code || '';
  codeDialog.editing = false;
  codeDialog.saving = false;
  codeDialog.visible = true;
};

const copyDialogCode = async () => {
  await navigator.clipboard.writeText(codeDialog.editing ? codeDialog.draftCode : codeDialog.code);
  ElMessage.success('代码已复制');
};

const editCodeDialog = () => {
  codeDialog.draftCode = codeDialog.code;
  codeDialog.editing = true;
};

const undoCodeDialogChanges = () => {
  codeDialog.draftCode = codeDialog.code;
  codeDialog.editing = false;
};

const saveCodeDialog = async () => {
  if (!codeDialog.scriptId || codeDialog.saving) return;

  codeDialog.saving = true;
  try {
    const payload = await api.updateScriptCode({
      id: codeDialog.scriptId,
      code: codeDialog.draftCode,
    });

    codeDialog.code = payload.script?.code || codeDialog.draftCode;
    codeDialog.draftCode = codeDialog.code;
    codeDialog.editing = false;
    await loadSavedScripts(payload.script?.id || codeDialog.scriptId);
    ElMessage.success('代码已保存');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '代码格式错误，无法保存');
  } finally {
    codeDialog.saving = false;
  }
};

const failActionDialog = (message: string) => {
  actionDialog.loading = false;
  actionDialog.error = message;
};

const addStep = () => {
  steps.value.push({
    id: crypto.randomUUID(),
    type: 'act',
    label: '新步骤',
    prompt: '',
    outputVar: '',
    value: '',
    enabled: true,
  });
};

const removeStep = (id: string) => {
  steps.value = steps.value.filter((item) => item.id !== id);
};

const copyCode = async () => {
  const code = generatedCodeEditing.value ? generatedCodeDraft.value : generatedCode.value;
  await navigator.clipboard.writeText(code);
  ElMessage.success('代码已复制');
};

const editGeneratedCode = () => {
  if (!showGeneratedCode.value) return;
  generatedCodeDraft.value = generatedCode.value;
  generatedCodeEditing.value = true;
};

const undoGeneratedCodeChanges = () => {
  generatedCodeDraft.value = generatedCode.value;
  generatedCodeEditing.value = false;
};

const saveGeneratedCodeChanges = async () => {
  if (generatedCodeEditSaving.value) return;

  generatedCodeEditSaving.value = true;
  try {
    await api.validateScriptCode({ code: generatedCodeDraft.value });
    generatedCodeOverride.value = generatedCodeDraft.value;
    generatedCodeEditing.value = false;
    ElMessage.success('代码修改已保存');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '代码格式错误，无法保存');
  } finally {
    generatedCodeEditSaving.value = false;
  }
};

const importTestCase = async (file: File) => {
  if (importingTestCase.value) return;

  importingTestCase.value = true;
  try {
    const result = await api.importTestCaseFile(file);
    sourcePrompt.value = result.prompt;
    importedTestCaseFileName.value = result.fileName;
    steps.value = [];
    showGeneratedCode.value = false;
    errorMessage.value = '';
    resetGeneratedCodeEditor();
    ElMessage.success(`已导入 ${result.caseCount} 条测试用例`);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '测试用例文件导入失败');
  } finally {
    importingTestCase.value = false;
  }
};

const clearGeneratorPage = () => {
  form.testName = '';
  form.promptTitle = '';
  form.appPresetId = '';
  sourcePrompt.value = '';
  steps.value = [];
  showGeneratedCode.value = false;
  importedTestCaseFileName.value = '';
  errorMessage.value = '';
  resetGeneratedCodeEditor();
  ElMessage.success('页面内容已清除');
};

const clearExecutionLog = () => {
  executionLog.value = '';
};

const copyExecutionLog = async () => {
  if (!executionLog.value) return;

  await navigator.clipboard.writeText(executionLog.value);
  ElMessage.success('日志已复制');
};

const validateBaseGeneratorInputs = () => {
  const scriptName = form.testName.trim();
  const promptTitle = form.promptTitle.trim();

  if (!scriptName) {
    ElMessage.error('请输入脚本名称');
    return null;
  }

  if (!promptTitle) {
    ElMessage.error('请输入场景标题');
    return null;
  }

  return { scriptName, promptTitle };
};

const validateAiGeneratorInputs = () => {
  const baseInput = validateBaseGeneratorInputs();
  if (!baseInput) return null;

  const rawPrompt = sourcePrompt.value.trim();
  if (!rawPrompt) {
    ElMessage.error('请输入原始 Prompt');
    return null;
  }

  return { ...baseInput, rawPrompt };
};

const validateManualGeneratorInputs = () => {
  const baseInput = validateBaseGeneratorInputs();
  if (!baseInput) return null;

  const enabledSteps = steps.value.filter((step) => step.enabled !== false);
  if (!enabledSteps.length) {
    ElMessage.error('请至少新增一个开启状态的步骤');
    return null;
  }

  const emptyPromptStep = enabledSteps.find((step) => !step.prompt.trim());
  if (emptyPromptStep) {
    ElMessage.error(`步骤“${emptyPromptStep.label || '未命名步骤'}”的 Prompt 不能为空`);
    return null;
  }

  return baseInput;
};

const validateCurrentGeneratorInputs = () => (
  activeGeneratorMode.value === 'manual'
    ? validateManualGeneratorInputs()
    : validateAiGeneratorInputs()
);

const buildSourcePromptForSave = () => {
  if (activeGeneratorMode.value === 'manual') {
    return appPromptPrefix.value.trim();
  }
  return effectiveSourcePrompt.value;
};

const saveCurrentScript = async () => {
  const validInput = validateCurrentGeneratorInputs();
  if (!validInput) return;

  if (generatedCodeEditing.value) {
    ElMessage.error('请先保存或撤回代码修改');
    return;
  }

  if (!showGeneratedCode.value || !generatedCode.value.trim()) {
    ElMessage.error('请先点击 AI 生成，生成代码后再保存脚本');
    return;
  }

  const { scriptName, promptTitle } = validInput;
  const checkPayload = await api.checkScript({ scriptName });

  if (checkPayload.exists) {
    try {
      await ElMessageBox.confirm(`已存在同名脚本“${scriptName}”，是否覆盖？`, '提示', {
        type: 'warning',
        confirmButtonText: '覆盖',
        cancelButtonText: '取消',
      });
    } catch {
      return;
    }
  }

  const startedAt = Date.now();
  openActionDialog('保存脚本');

  try {
    const payload = await api.saveScript({
      scriptName,
      code: generatedCode.value,
      promptTitle,
      sourcePrompt: buildSourcePromptForSave(),
      steps: steps.value,
    });

    await loadSavedScripts(payload.script?.id || '');
    await sleep(Math.max(0, 1200 - (Date.now() - startedAt)));
    closeActionDialog();
  } catch (error) {
    failActionDialog(error instanceof Error ? error.message : '保存脚本失败');
  }
};

const removeSavedScript = async (id: string) => {
  const script = savedScripts.value.find((item) => item.id === id);
  try {
    await ElMessageBox.confirm(
      `确定删除脚本“${script?.promptTitle || script?.name || '未命名脚本'}”吗？删除后对应的脚本文件也会移除。`,
      '删除脚本',
      {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
      },
    );
  } catch {
    return;
  }

  try {
    await api.deleteScript({ id });
    await loadSavedScripts(selectedScriptId.value === id ? '' : selectedScriptId.value);
  } catch (error) {
    playgroundPreviewError.value = error instanceof Error ? error.message : '删除脚本失败';
  }
};

const generateWithModel = async () => {
  if (!validateCurrentGeneratorInputs()) return;

  if (activeGeneratorMode.value === 'manual') {
    resetGeneratedCodeEditor();
    showGeneratedCode.value = true;
    ElMessage.success('代码已生成');
    return;
  }

  isGenerating.value = true;
  errorMessage.value = '';
  openActionDialog('AI生成');

  try {
    const payload = await api.generatePlan({
      prompt: effectiveSourcePrompt.value,
    });

    form.promptTitle = payload.promptTitle || form.promptTitle;
    steps.value = (payload.steps || []).map((step) => ({ ...step, id: crypto.randomUUID() }));
    resetGeneratedCodeEditor();
    showGeneratedCode.value = true;
    closeActionDialog();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI 生成失败';
    errorMessage.value = message;
    failActionDialog(message);
  } finally {
    await loadModelUsageRecords().catch(() => undefined);
    isGenerating.value = false;
  }
};

const loadConfig = async () => {
  const payload = await api.getConfig();
  Object.assign(configForm.runtime, payload.runtime || {});
  Object.assign(configForm.midscene.model, payload.midscene.model);
  Object.keys(configForm.midscene.env).forEach((key) => {
    delete configForm.midscene.env[key];
  });
  Object.assign(configForm.midscene.env, payload.midscene.env || {});
  Object.assign(configForm.scriptOptimizer.model, payload.scriptOptimizer.model);
  if (configForm.midscene.model.provider !== 'codex') {
    rememberCustomMidsceneModel();
  }
};

const rememberCustomMidsceneModel = () => {
  if (configForm.midscene.model.provider === 'codex') return;
  lastCustomMidsceneModel.baseUrl = configForm.midscene.model.baseUrl;
  lastCustomMidsceneModel.apiKey = configForm.midscene.model.apiKey;
  lastCustomMidsceneModel.name = configForm.midscene.model.name;
  lastCustomMidsceneModel.family = configForm.midscene.model.family;
};

const updateMidsceneModelProvider = (provider: MidsceneModelProvider) => {
  if (provider === 'codex') {
    rememberCustomMidsceneModel();
    Object.assign(configForm.midscene.model, codexMidsceneModel);
  } else {
    Object.assign(configForm.midscene.model, {
      provider: 'custom',
      ...lastCustomMidsceneModel,
    });
  }
  modelTestStatus.midscene = '';
};

const applyMidsceneModelPreset = (key: MidsceneModelPresetKey) => {
  const preset = midsceneModelPresets.find((item) => item.key === key);
  if (!preset) return;

  configForm.midscene.model.provider = 'custom';
  configForm.midscene.model.baseUrl = preset.baseUrl;
  configForm.midscene.model.name = preset.modelName;
  configForm.midscene.model.family = preset.modelFamily;
  rememberCustomMidsceneModel();
  modelTestStatus.midscene = '';
};

const getMidsceneModelConfigError = () => {
  const model = configForm.midscene.model;
  const missing = [];

  if (!model.baseUrl.trim()) missing.push('Base URL');
  if (!model.name.trim()) missing.push('Model Name');
  if (!model.family.trim()) missing.push('Model Family');
  if (model.provider !== 'codex' && !model.apiKey.trim()) missing.push('API Key');

  if (!missing.length) return '';
  return `Midscene 模型配置不完整：缺少 ${missing.join('、')}。请在“参数配置 > Midscene 模型”中选择“使用 Codex”，或补齐自定义提供方后保存。`;
};

const saveModelConfig = async () => {
  isSavingModelConfig.value = true;
  errorMessage.value = '';
  openActionDialog('保存参数配置');
  try {
    await api.saveConfig(configForm);
    closeActionDialog();
    ElMessage.success('参数配置已保存');
  } catch (error) {
    const message = error instanceof Error ? error.message : '参数配置保存失败';
    errorMessage.value = message;
    failActionDialog(message);
  } finally {
    isSavingModelConfig.value = false;
  }
};

const loadAppPresets = async () => {
  const payload = await api.getAppPresets();
  appPresets.value = payload.apps || [];
};

const editAppPreset = (app: AppPreset) => {
  appPresetForm.id = app.id;
  appPresetForm.name = app.name;
  appPresetForm.packageName = app.packageName;
};

const resetAppPresetForm = () => {
  appPresetForm.id = '';
  appPresetForm.name = '';
  appPresetForm.packageName = '';
};

const saveAppPreset = async () => {
  isSavingAppPreset.value = true;
  errorMessage.value = '';
  openActionDialog('保存 App 配置');
  try {
    const payload = await api.saveAppPreset({
      id: appPresetForm.id || undefined,
      name: appPresetForm.name,
      packageName: appPresetForm.packageName,
    });
    await loadAppPresets();
    if (payload.app?.id) {
      form.appPresetId = payload.app.id;
    }
    resetAppPresetForm();
    closeActionDialog();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'App 配置保存失败';
    errorMessage.value = message;
    failActionDialog(message);
  } finally {
    isSavingAppPreset.value = false;
  }
};

const removeAppPreset = async (id: string) => {
  try {
    await ElMessageBox.confirm('确定删除这个 App 配置吗？', '删除 App 配置', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    });
  } catch {
    return;
  }

  try {
    await api.deleteAppPreset({ id });
    await loadAppPresets();
    if (form.appPresetId === id) {
      form.appPresetId = '';
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'App 配置删除失败';
  }
};

const loadModelUsageRecords = async () => {
  const payload = await api.getModelUsageRecords(50);
  modelUsageRecords.value = payload.records || [];
};

const testModel = async (key: 'midscene' | 'scriptOptimizer') => {
  testingModelKey.value = key;
  errorMessage.value = '';
  modelTestStatus[key] = '';
  const model =
    key === 'midscene'
      ? configForm.midscene.model
      : configForm.scriptOptimizer.model;

  try {
    const payload = await api.testModel({ modelKey: key, model });
    modelTestStatus[key] = payload.content || '连接成功';
  } catch (error) {
    modelTestStatus[key] = error instanceof Error ? error.message : '测试失败';
  } finally {
    await loadModelUsageRecords().catch(() => undefined);
    testingModelKey.value = '';
  }
};

const loadAndroidDevices = async () => {
  if (backendOffline.value) return;
  try {
    const payload = await api.getAndroidDevices();
    backendOffline.value = false;
    androidDevices.value = payload.devices || [];
    playgroundDeviceId.value = payload.currentDeviceId || '';
    playgroundAvailable.value = androidDevices.value.some((item) => item.status === 'device');
  } catch (error) {
    if (isBackendFetchError(error)) {
      markBackendOffline();
      return;
    }
    throw error;
  }
};

const loadDeviceInterface = async () => {
  try {
    const payload = await api.getAndroidDisplayInfo(playgroundDeviceId.value);
    deviceInterfaceSize.width = Number(payload.width) || 0;
    deviceInterfaceSize.height = Number(payload.height) || 0;
  } catch {
    deviceInterfaceSize.width = 0;
    deviceInterfaceSize.height = 0;
  }
};

const loadAdbPreview = () => {
  if (backendOffline.value) return;
  if (!playgroundDeviceId.value) {
    devicePreviewUrl.value = '';
    devicePreviewMode.value = '';
    return;
  }

  devicePreviewUrl.value = `${api.APP_BASE}/api/android-preview?deviceId=${encodeURIComponent(playgroundDeviceId.value)}&t=${Date.now()}`;
  devicePreviewMode.value = 'screenshot';
};

const refreshAdbPreviewAfterInput = () => {
  if (devicePreviewMode.value === 'screenshot' && devicePreviewUrl.value) {
    window.setTimeout(loadAdbPreview, 120);
  }
};

const refreshDevicePreview = () => {
  if (devicePreviewMode.value === 'stream' && playgroundFrameUrl.value) {
    playgroundFrameUrl.value = `${api.APP_BASE}/__android_playground__/?ts=${Date.now()}`;
    return;
  }
  loadAdbPreview();
};

const startAppiumPreviewTimer = () => {
  if (backendOffline.value) return;
  if (appiumPreviewTimer) return;
  loadAdbPreview();
  appiumPreviewTimer = window.setInterval(loadAdbPreview, 1000);
};

const stopAppiumPreviewTimer = () => {
  if (!appiumPreviewTimer) return;
  window.clearInterval(appiumPreviewTimer);
  appiumPreviewTimer = null;
};

const markBackendOffline = () => {
  if (backendOffline.value) return;
  backendOffline.value = true;
  playgroundAvailable.value = false;
  playgroundFrameUrl.value = '';
  playgroundFrameSignature.value = '';
  devicePreviewUrl.value = '';
  devicePreviewMode.value = '';
  playgroundPreviewError.value = '本地服务已断开，请重新运行启动命令后刷新页面。';
  errorMessage.value = playgroundPreviewError.value;
  stopPlaygroundPollTimer();
  stopAppiumPreviewTimer();
};

const loadPlaygroundStatus = async () => {
  if (backendOffline.value) return;
  if (!playgroundDeviceId.value) {
    stopAppiumPreviewTimer();
    playgroundAvailable.value = false;
    playgroundPreviewError.value = '';
    playgroundFrameUrl.value = '';
    playgroundFrameSignature.value = '';
    devicePreviewUrl.value = '';
    devicePreviewMode.value = '';
    return;
  }

  try {
    await loadDeviceInterface();
    const payload = await api.getPlaygroundStatus();

    const matchedDevice = !payload.deviceId || payload.deviceId === playgroundDeviceId.value;
    const hasRealtimeStream = payload.previewKind === 'scrcpy' && payload.sessionConnected === true;
    const hasPlayground = Boolean(payload.available) && matchedDevice && hasRealtimeStream;
    playgroundAvailable.value = androidDevices.value.some((item) => item.status === 'device');
    playgroundPreviewError.value =
      matchedDevice && !hasRealtimeStream
        ? payload.previewError || payload.setupState || ''
        : `未找到设备 ${playgroundDeviceId.value} 对应的 Playground 实例`;

    const nextSignature = `${payload.url || ''}::${playgroundDeviceId.value}`;
    if (hasPlayground) {
      stopAppiumPreviewTimer();
      if (nextSignature !== playgroundFrameSignature.value || !playgroundFrameUrl.value) {
        playgroundFrameSignature.value = nextSignature;
        playgroundFrameUrl.value = `${api.APP_BASE}/__android_playground__/?ts=${Date.now()}`;
      }
      devicePreviewUrl.value = '';
      devicePreviewMode.value = 'stream';
      playgroundPreviewError.value = '';
    }

    if (!hasPlayground) {
      playgroundFrameUrl.value = '';
      playgroundFrameSignature.value = '';
      loadAdbPreview();
      if (activeMenu.value === 'appium') startAppiumPreviewTimer();
    }
  } catch (error) {
    if (isBackendFetchError(error)) {
      markBackendOffline();
      return;
    }
    playgroundAvailable.value = false;
    playgroundFrameUrl.value = '';
    playgroundFrameSignature.value = '';
    loadAdbPreview();
    playgroundPreviewError.value = error instanceof Error ? error.message : '设备预览不可用';
  }
};

const tapDevice = async (x: number, y: number) => {
  deviceDebug.action = 'tap';
  deviceDebug.status = 'pending';
  try {
    await api.tapAndroid({
      deviceId: playgroundDeviceId.value,
      x,
      y,
    });
    deviceDebug.status = 'ok';
    deviceDebug.message = 'tap sent';
    refreshAdbPreviewAfterInput();
  } catch (error) {
    deviceDebug.status = 'error';
    deviceDebug.message = error instanceof Error ? error.message : '点击失败';
    throw error;
  }
};

const swipeDevice = async (startX: number, startY: number, endX: number, endY: number, duration = 120) => {
  deviceDebug.action = 'swipe';
  deviceDebug.status = 'pending';
  try {
    await api.swipeAndroid({
      deviceId: playgroundDeviceId.value,
      startX,
      startY,
      endX,
      endY,
      duration,
    });
    deviceDebug.status = 'ok';
    deviceDebug.message = 'swipe sent';
    refreshAdbPreviewAfterInput();
  } catch (error) {
    deviceDebug.status = 'error';
    deviceDebug.message = error instanceof Error ? error.message : '滑动失败';
    throw error;
  }
};

const switchAndroidDevice = async (deviceId: string) => {
  try {
    const payload = await api.setAndroidDevice({ deviceId });
    playgroundDeviceId.value = payload.currentDeviceId || deviceId;
    await loadPlaygroundStatus();
  } catch (error) {
    playgroundPreviewError.value = error instanceof Error ? error.message : '切换设备失败';
  }
};

const triggerDeviceKey = async (keyCode: number) => {
  if (!playgroundDeviceId.value) {
    return;
  }
  try {
    await api.sendAndroidKeyevent({
      deviceId: playgroundDeviceId.value,
      keyCode,
    });
    refreshAdbPreviewAfterInput();
  } catch (error) {
    playgroundPreviewError.value = error instanceof Error ? error.message : '操作失败';
  }
};

const buildExecutionProcess = (script: SavedScript): ExecutionStep[] => {
  const activeSteps = (script.steps || []).filter((step) => step.enabled !== false);
  if (!activeSteps.length) {
    return [
      {
        id: 'script',
        sourceIndex: 0,
        title: script.promptTitle || script.name,
        method: 'script',
        prompt: script.filePath,
        status: 'pending',
        detail: '等待执行脚本',
      },
    ];
  }

  return activeSteps
    .map((step, index) => ({
      id: step.id || `${script.id}-${index}`,
      sourceIndex: index,
      title: step.label || `步骤 ${index + 1}`,
      method: step.type,
      prompt: step.prompt || step.value || '',
      status: 'pending' as const,
      detail: '等待前置步骤完成',
    }))
    .filter((step) => step.title !== '统一处理弹窗');
};

const markExecutionProcess = (success: boolean, output: string) => {
  if (!executionProcess.value.length) return;
  const runningIndex = executionProcess.value.findIndex((step) => step.status === 'running');
  const errorIndex = executionProcess.value.findIndex((step) => step.status === 'error');
  const failedIndex = success
    ? -1
    : runningIndex >= 0
      ? runningIndex
      : errorIndex >= 0
        ? errorIndex
        : Math.max(0, executionProcess.value.length - 1);
  executionProcess.value = executionProcess.value.map((step, index) => {
    if (success || index < failedIndex) {
      return { ...step, status: 'success', detail: '执行完成' };
    }
    if (index === failedIndex) {
      return {
        ...step,
        status: 'error',
        detail: output || '执行失败',
      };
    }
    return step;
  });
};

const formatElapsed = (startedAt: number) => `${Math.max(0, Math.floor((Date.now() - startedAt) / 1000))} 秒`;
const formatCompactDuration = (milliseconds: number) => {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m${seconds}s` : `${seconds}s`;
};
const runningElapsedText = computed(() => {
  if (lastRunStatus.value !== '执行中' || !runStartedAt.value) return '';
  return formatCompactDuration(runningElapsedNow.value - runStartedAt.value);
});

const updateRunningStepElapsed = () => {
  if (runStartedAt.value) {
    runningElapsedNow.value = Date.now();
  }
  executionProcess.value = executionProcess.value.map((step) => {
    if (step.status !== 'running' || !step.startedAt) {
      return step;
    }
    return {
      ...step,
      detail: `执行中，已耗时 ${formatElapsed(step.startedAt)}`,
    };
  });
};

const startExecutionProgressTimer = () => {
  if (executionProgressTimer) {
    window.clearInterval(executionProgressTimer);
  }
  executionProgressTimer = window.setInterval(updateRunningStepElapsed, 1000);
};

const stopExecutionProgressTimer = () => {
  if (!executionProgressTimer) return;
  window.clearInterval(executionProgressTimer);
  executionProgressTimer = null;
};

const appendExecutionStepLog = (event: Extract<RunScriptStreamEvent, { type: 'step' }>) => {
  const title = event.title || `步骤 ${event.index + 1}`;
  if (event.status === 'start') {
    executionLog.value += `[步骤 ${event.index + 1}] 开始：${title}\n`;
    return;
  }
  if (event.status === 'success') {
    executionLog.value += `[步骤 ${event.index + 1}] 完成：${title}\n`;
    return;
  }
  executionLog.value += `[步骤 ${event.index + 1}] 失败：${title}${event.detail ? `\n${event.detail}` : ''}\n`;
};

const applyRunScriptEvent = (event: RunScriptStreamEvent) => {
  if (event.type === 'output') {
    executionLog.value += event.chunk;
    if (!lastRunStatus.value) {
      lastRunStatus.value = '执行中';
    }
    return;
  }

  if (event.type === 'error') {
    executionLog.value += `${event.message}\n`;
    markExecutionProcess(false, event.message);
    lastRunStatus.value = '执行失败';
    return;
  }

  if (event.type === 'step') {
    appendExecutionStepLog(event);
    executionProcess.value = executionProcess.value.map((step) => {
      if (step.sourceIndex !== event.index) {
        return step;
      }

      if (event.status === 'start') {
        const startedAt = Date.now();
        return { ...step, status: 'running', startedAt, detail: `执行中，已耗时 ${formatElapsed(startedAt)}` };
      }
      if (event.status === 'success') {
        return { ...step, status: 'success', startedAt: undefined, detail: '执行完成' };
      }
      return {
        ...step,
        status: 'error',
        startedAt: undefined,
        detail: event.detail || '执行失败',
      };
    });
    return;
  }

  if (event.type === 'done') {
    if (event.output && !executionLog.value.trim()) {
      executionLog.value = event.output;
    }
    markExecutionProcess(event.success, event.output || executionLog.value);
    lastRunStatus.value = event.success ? '执行完成' : event.output.includes('脚本执行已停止') ? '已停止' : '执行失败';
  }
};

const runSelectedScript = async () => {
  if (isRunningScript.value) return;

  if (!selectedScript.value) {
    lastRunStatus.value = '请先选择脚本';
    return;
  }

  const modelConfigError = getMidsceneModelConfigError();
  if (modelConfigError) {
    lastRunStatus.value = '模型配置不完整';
    executionLog.value = modelConfigError;
    ElMessage.error('Midscene 模型配置不完整');
    return;
  }

  isRunningScript.value = true;
  isStoppingScript.value = false;
  runStartedAt.value = Date.now();
  runningElapsedNow.value = runStartedAt.value;
  executionLog.value = '';
  lastRunStatus.value = '执行中';

  try {
    await loadSavedScripts(selectedScriptId.value);
    const script = selectedScript.value;
    if (!script) {
      throw new Error('脚本不存在');
    }

    executionProcess.value = buildExecutionProcess(script);
    if (executionProcess.value[0]) {
      const startedAt = Date.now();
      executionProcess.value[0].status = 'running';
      executionProcess.value[0].startedAt = startedAt;
      executionProcess.value[0].detail = `执行中，已耗时 ${formatElapsed(startedAt)}`;
    }
    startExecutionProgressTimer();

    scriptRunAbortController = new AbortController();
    await api.runScript(
      {
        code: script.code,
        scriptName: script.name,
        deviceId: playgroundDeviceId.value,
        steps: script.steps || [],
        signal: scriptRunAbortController.signal,
      },
      applyRunScriptEvent,
    );

    if (!lastRunStatus.value) {
      lastRunStatus.value = '执行完成';
    }
    if (!executionLog.value.trim()) {
      executionLog.value = '执行完成，无输出';
    }
  } catch (error) {
    const isAbortError = error instanceof DOMException && error.name === 'AbortError';
    executionLog.value = isAbortError ? '脚本执行已停止。' : error instanceof Error ? error.message : '执行失败';
    markExecutionProcess(false, executionLog.value);
    lastRunStatus.value = isAbortError ? '已停止' : '执行失败';
  } finally {
    stopExecutionProgressTimer();
    await loadModelUsageRecords().catch(() => undefined);
    isRunningScript.value = false;
    isStoppingScript.value = false;
    runStartedAt.value = null;
    runningElapsedNow.value = 0;
    scriptRunAbortController = null;
  }
};

const stopSelectedScript = async () => {
  if (!isRunningScript.value || isStoppingScript.value) return;

  try {
    await ElMessageBox.confirm(
      '停止后当前脚本进程会立即终止，未完成步骤不会继续执行。确定停止吗？',
      '确认停止执行',
      {
        confirmButtonText: '停止执行',
        cancelButtonText: '继续执行',
        type: 'warning',
        confirmButtonClass: 'el-button--danger',
      },
    );
  } catch {
    return;
  }

  isStoppingScript.value = true;
  lastRunStatus.value = '停止中';

  try {
    await api.stopScript();
  } catch (error) {
    executionLog.value += `${error instanceof Error ? error.message : '停止执行失败'}\n`;
    scriptRunAbortController?.abort();
  }
};

watch(
  () => generatedCode.value,
  () => {
    if (!selectedScriptId.value && savedScripts.value.length) {
      selectedScriptId.value = savedScripts.value[0].id;
    }
  },
);

watch(activeMenu, (menu) => {
  window.localStorage.setItem(ACTIVE_MENU_STORAGE_KEY, menu);
  if (menu === 'appium' || menu === 'automation') {
    stopAppiumPreviewTimer();
    void loadPlaygroundStatus();
  } else {
    stopAppiumPreviewTimer();
  }
}, { immediate: true });

onMounted(async () => {
  try {
    await migrateLegacySavedScripts();
  } catch (error) {
    console.warn('脚本缓存迁移失败', error);
  }

  await Promise.allSettled([loadConfig(), loadAppPresets(), loadAndroidDevices(), loadSavedScripts(), loadModelUsageRecords()]);
  await loadPlaygroundStatus();
  playgroundPollTimer = window.setInterval(() => {
    if (backendOffline.value) {
      stopPlaygroundPollTimer();
      return;
    }
    void loadAndroidDevices();
    void loadPlaygroundStatus();
  }, 2500);
});

onUnmounted(() => {
  stopPlaygroundPollTimer();
  stopAppiumPreviewTimer();
  stopExecutionProgressTimer();
  scriptRunAbortController?.abort();
});
</script>

<template>
  <div class="layout">
    <el-dialog
      v-model="actionDialog.visible"
      :title="actionDialog.title"
      width="360px"
      :close-on-click-modal="false"
      :close-on-press-escape="!actionDialog.loading"
      :show-close="!actionDialog.loading"
      class="action-dialog"
    >
      <div v-if="actionDialog.loading" class="action-dialog__body">
        <el-icon class="action-dialog__spinner"><Loading /></el-icon>
        <span>处理中...</span>
      </div>
      <div v-else-if="actionDialog.error" class="action-dialog__error">
        {{ actionDialog.error }}
      </div>
      <template #footer>
        <el-button v-if="!actionDialog.loading" type="primary" @click="closeActionDialog">关闭</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="codeDialog.visible"
      :title="codeDialog.title"
      width="760px"
      class="code-dialog"
    >
      <div class="code-dialog__toolbar">
        <el-button :icon="CopyDocument" @click="copyDialogCode">复制</el-button>
        <el-button v-if="!codeDialog.editing" type="primary" :icon="Edit" @click="editCodeDialog">
          编辑
        </el-button>
        <template v-else>
          <el-button :icon="RefreshLeft" :disabled="codeDialog.saving" @click="undoCodeDialogChanges">
            撤回修改
          </el-button>
          <el-button type="primary" :loading="codeDialog.saving" @click="saveCodeDialog">
            保存
          </el-button>
        </template>
      </div>
      <el-input
        v-if="codeDialog.editing"
        v-model="codeDialog.draftCode"
        type="textarea"
        resize="none"
        class="code-dialog__editor"
      />
      <pre v-else class="code-block code-dialog__body"><code>{{ codeDialog.code || '暂无代码' }}</code></pre>
    </el-dialog>

    <aside class="layout-sidebar">
      <div class="layout-sidebar__top">
        <div class="layout-sidebar__logo">MS</div>
      </div>
      <el-menu :default-active="activeMenu" :default-openeds="['midscene']" class="layout-menu" @select="selectMenu">
        <el-sub-menu index="midscene">
          <template #title>
            <el-icon><Operation /></el-icon>
            <span>Midscene</span>
          </template>
          <el-menu-item v-for="item in menuItems" :key="item.key" :index="item.key">
            <el-icon><component :is="item.icon" /></el-icon>
            <span>{{ item.label }}</span>
          </el-menu-item>
        </el-sub-menu>
        <el-menu-item index="appium">
          <el-icon><Monitor /></el-icon>
          <span>Appium</span>
        </el-menu-item>
        <el-menu-item index="config">
          <el-icon><Setting /></el-icon>
          <span>参数配置</span>
        </el-menu-item>
      </el-menu>
    </aside>

    <div class="layout-main">
      <header class="layout-header">
        <div class="layout-header__title">
          {{ activeMenuLabel }}
        </div>
        <div class="layout-header__actions">
          <el-button
            v-if="activeMenu === 'generator'"
            type="primary"
            :icon="Check"
            :loading="isGenerating"
            @click="generateWithModel"
          >
            AI 生成
          </el-button>
          <el-button
            v-if="activeMenu === 'generator'"
            :icon="Check"
            :disabled="!showGeneratedCode || generatedCodeEditing"
            @click="saveCurrentScript"
          >
            保存脚本
          </el-button>
          <el-button
            v-if="activeMenu === 'automation' && !isRunningScript"
            type="primary"
            :icon="VideoPlay"
            @click="runSelectedScript"
          >
            开始执行
          </el-button>
          <el-button
            v-if="activeMenu === 'automation' && isRunningScript"
            type="danger"
            :icon="VideoPause"
            :loading="isStoppingScript"
            @click="stopSelectedScript"
          >
            {{ isStoppingScript ? '停止中' : '停止执行' }}
          </el-button>
        </div>
      </header>

      <main
        class="page-body"
        :class="{
          'page-body--fixed': activeMenu === 'generator' && activeGeneratorMode === 'ai',
          'page-body--appium': activeMenu === 'appium',
        }"
      >
        <el-alert v-if="activeMenu !== 'appium' && errorMessage" type="error" :closable="false" show-icon class="page-alert">
          <template #title>{{ errorMessage }}</template>
        </el-alert>

        <GeneratorPage
          v-show="activeMenu === 'generator'"
          v-model:mode="activeGeneratorMode"
          v-model:source-prompt="sourcePrompt"
          v-model:generated-code-draft="generatedCodeDraft"
          :form="form"
          :app-presets="appPresets"
          :prompt-example="promptDocument.trim()"
          :steps="steps"
          :generated-code="generatedCode"
          :show-generated-code="showGeneratedCode"
          :generated-code-editing="generatedCodeEditing"
          :generated-code-edit-saving="generatedCodeEditSaving"
          :importing-test-case="importingTestCase"
          :imported-test-case-file-name="importedTestCaseFileName"
          @add-step="addStep"
          @remove-step="removeStep"
          @copy-code="copyCode"
          @edit-code="editGeneratedCode"
          @undo-code="undoGeneratedCodeChanges"
          @save-code="saveGeneratedCodeChanges"
          @import-test-case="importTestCase"
          @clear-all="clearGeneratorPage"
        />

        <ConfigPage
          v-show="activeMenu === 'config'"
          :config-form="configForm"
          :app-presets="appPresets"
          :app-preset-form="appPresetForm"
          :testing-model-key="testingModelKey"
          :is-saving-model-config="isSavingModelConfig"
          :is-saving-app-preset="isSavingAppPreset"
          :model-test-status="modelTestStatus"
          :model-usage-records="modelUsageRecords"
          @test-model="testModel"
          @save-model-config="saveModelConfig"
          @save-app-preset="saveAppPreset"
          @edit-app-preset="editAppPreset"
          @delete-app-preset="removeAppPreset"
          @update-midscene-model-provider="updateMidsceneModelProvider"
          @apply-midscene-model-preset="applyMidsceneModelPreset"
        />

        <AutomationPage
          v-show="activeMenu === 'automation'"
          v-model:selected-script-id="selectedScriptId"
          :saved-scripts="savedScripts"
          :selected-script="selectedScript"
          :playground-available="playgroundAvailable"
          :playground-device-id="playgroundDeviceId"
          :playground-frame-url="activeMenu === 'automation' ? playgroundFrameUrl : ''"
          :playground-preview-error="playgroundPreviewError"
          :device-preview-url="activeMenu === 'automation' ? devicePreviewUrl : ''"
          :android-devices="androidDevices"
          :device-actions="deviceActions"
          :device-width="deviceInterfaceSize.width"
          :device-height="deviceInterfaceSize.height"
          :execution-log="executionLog"
          :execution-process="executionProcess"
          :last-run-status="lastRunStatus"
          :running-elapsed-text="runningElapsedText"
          :format-script-time="formatScriptTime"
          :switch-android-device="switchAndroidDevice"
          :trigger-device-key="triggerDeviceKey"
          :refresh-device-preview="refreshDevicePreview"
          :open-code-dialog="openCodeDialog"
          :remove-saved-script="removeSavedScript"
          :tap-device="tapDevice"
          :swipe-device="swipeDevice"
          @copy-execution-log="copyExecutionLog"
          @clear-execution-log="clearExecutionLog"
        />

        <AppiumPage
          v-show="activeMenu === 'appium'"
          :active="activeMenu === 'appium'"
          :app-presets="appPresets"
          :device-actions="deviceActions"
          :playground-available="playgroundAvailable"
          :playground-device-id="playgroundDeviceId"
          :playground-frame-url="activeMenu === 'appium' ? playgroundFrameUrl : ''"
          :playground-preview-error="playgroundPreviewError"
          :device-preview-url="activeMenu === 'appium' ? devicePreviewUrl : ''"
          :android-devices="androidDevices"
          :device-width="deviceInterfaceSize.width"
          :device-height="deviceInterfaceSize.height"
          :switch-android-device="switchAndroidDevice"
          :trigger-device-key="triggerDeviceKey"
          :refresh-device-preview="refreshDevicePreview"
          :swipe-device="swipeDevice"
        />
      </main>
    </div>
  </div>
</template>
