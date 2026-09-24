<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, onUnmounted, reactive, ref, shallowRef, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  Check,
  Close,
  DataAnalysis,
  CopyDocument,
  Edit,
  Loading,
  Monitor,
  Operation,
  InfoFilled,
  Fold,
  Expand,
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
import { defaultPromptPresetId, promptPresets } from './config/prompt-presets';
import {
  buildScript,
  type ScriptStep,
} from './script-generator';
import * as api from './api';
import { useModelConfig } from './config/use-model-config';
import { useDevicePreview } from './composables/use-device-preview';
import { useScriptExecution } from './composables/use-script-execution';
import { useInitialResource } from './composables/use-initial-resource';
import AppSidebar from './components/AppSidebar.vue';
const AnalysisPage = defineAsyncComponent(() => import('./pages/AnalysisPage.vue'));
const AutomationPage = defineAsyncComponent(() => import('./pages/AutomationPage.vue'));
const AppiumPage = defineAsyncComponent(() => import('./appium-recorder/AppiumPage.vue'));
const ConfigPage = defineAsyncComponent(() => import('./pages/ConfigPage.vue'));
const GeneratorPage = defineAsyncComponent(() => import('./pages/GeneratorPage.vue'));
const HelpCenter = defineAsyncComponent(() => import('./components/help/HelpCenter.vue'));
import type {
  AppPreset,
  GeneratorMode,
  MenuKey,
  SavedScript,
} from './types';

const ACTIVE_MENU_STORAGE_KEY = 'android-midscene-automation:active-menu';
const menuKeys: MenuKey[] = ['analysis', 'generator', 'automation', 'config', 'appium', 'about'];
const storedMenu = window.localStorage.getItem(ACTIVE_MENU_STORAGE_KEY) as MenuKey | null;
const activeMenu = ref<MenuKey>(storedMenu && menuKeys.includes(storedMenu) ? storedMenu : 'generator');
const activeGeneratorMode = ref<GeneratorMode>('ai');
const defaultSourcePrompt = promptPresets.find((item) => item.id === defaultPromptPresetId)?.content || '';
const sourcePrompt = ref(defaultSourcePrompt);
const promptPresetId = shallowRef(defaultPromptPresetId);
const steps = ref<ScriptStep[]>([]);
const errorMessage = ref('');
const isGenerating = ref(false);
const isSavingAppPreset = ref(false);
const showGeneratedCode = ref(false);
const generatedCodeOverride = shallowRef<string | null>(null);
const generatedCodeDraft = shallowRef('');
const generatedCodeEditing = shallowRef(false);
const generatedCodeEditSaving = shallowRef(false);
const importingTestCase = shallowRef(false);
const importedTestCaseFileName = shallowRef('');
const selectedScriptId = ref('');
const savedScripts = ref<SavedScript[]>([]);
const appPresets = ref<AppPreset[]>([]);
const actionDialog = reactive({
  visible: false,
  title: '',
  loading: false,
  error: '',
  canRunInBackground: false,
  canCancel: false,
  cancelText: '终止',
  canceling: false,
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
let aiGenerateAbortController: AbortController | null = null;

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

const { ready: configReady, configForm, appiumAutoSave, isSavingModelConfig, testingModelKey, modelTestStatus, aiRecognitionModelConfigured, loadConfig, updateMidsceneModelProvider, getMidsceneModelConfigError, saveModelConfig, testModel } = useModelConfig();
const { connectionError, reconnecting, reconnect, playgroundAvailable, playgroundPreviewError, playgroundDeviceId, playgroundFrameUrl, devicePreviewUrl, androidDevices, deviceInterfaceSize, refreshDevicePreview, tapDevice, swipeDevice, switchAndroidDevice, triggerDeviceKey } = useDevicePreview(activeMenu);
const { isRunningScript, isStoppingScript, executionLog, executionProcess, lastRunStatus, runningElapsedText, runSelectedScript, stopSelectedScript } = useScriptExecution(computed(() => selectedScript.value), selectedScriptId, playgroundDeviceId, id => loadSavedScripts(id), getMidsceneModelConfigError);
const visitedMenus = reactive(new Set<MenuKey>([activeMenu.value]));
const openMenus = ref<MenuKey[]>([...menuKeys]);
const visibleMenuItems = computed(() => openMenus.value.map(key => menuItems.find(item => item.key === key)!));
function closeMenu(key: MenuKey) {
  if (openMenus.value.length === 1) return;
  const index = openMenus.value.indexOf(key);
  openMenus.value.splice(index, 1);
  if (activeMenu.value === key) activeMenu.value = openMenus.value[Math.max(0, index - 1)];
}

const sidebarCollapsed = shallowRef(false);
const menuItems = [
  { key: 'analysis', label: '分析页', icon: DataAnalysis },
  { key: 'generator', label: '测试脚本生成', icon: Operation },
  { key: 'automation', label: '自动化测试', icon: Monitor },
  { key: 'appium', label: 'Appium', icon: Monitor },
  { key: 'config', label: '参数配置', icon: Setting },
  { key: 'about', label: '关于', icon: InfoFilled },
] as const;
const activeMenuLabel = computed(() => {
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

type ActionDialogOptions = {
  canRunInBackground?: boolean;
  canCancel?: boolean;
  cancelText?: string;
};

const openActionDialog = (title: string, options: ActionDialogOptions = {}) => {
  actionDialog.visible = true;
  actionDialog.title = title;
  actionDialog.loading = true;
  actionDialog.error = '';
  actionDialog.canRunInBackground = !!options.canRunInBackground;
  actionDialog.canCancel = !!options.canCancel;
  actionDialog.cancelText = options.cancelText || '终止';
  actionDialog.canceling = false;
};

const closeActionDialog = () => {
  actionDialog.visible = false;
  actionDialog.loading = false;
  actionDialog.error = '';
  actionDialog.canRunInBackground = false;
  actionDialog.canCancel = false;
  actionDialog.cancelText = '终止';
  actionDialog.canceling = false;
};

const sendActionDialogToBackground = () => {
  if (!actionDialog.loading || !actionDialog.canRunInBackground) return;
  actionDialog.visible = false;
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
  actionDialog.canceling = false;
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
  promptPresetId.value = defaultPromptPresetId;
  sourcePrompt.value = defaultSourcePrompt;
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

const isAbortError = (error: unknown) =>
  error instanceof DOMException && error.name === 'AbortError';

const stopGenerateWithModel = () => {
  if (!aiGenerateAbortController || aiGenerateAbortController.signal.aborted) return;
  actionDialog.canceling = true;
  aiGenerateAbortController.abort();
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
  if (isGenerating.value) {
    actionDialog.visible = true;
    return;
  }

  if (!validateCurrentGeneratorInputs()) return;

  if (activeGeneratorMode.value === 'manual') {
    resetGeneratedCodeEditor();
    showGeneratedCode.value = true;
    ElMessage.success('代码已生成');
    return;
  }

  isGenerating.value = true;
  errorMessage.value = '';
  const controller = new AbortController();
  aiGenerateAbortController = controller;
  openActionDialog('AI生成', {
    canRunInBackground: true,
    canCancel: true,
    cancelText: '终止',
  });

  try {
    const payload = await api.generatePlan({
      prompt: effectiveSourcePrompt.value,
      signal: controller.signal,
    });

    form.promptTitle = payload.promptTitle || form.promptTitle;
    steps.value = (payload.steps || []).map((step) => ({ ...step, id: crypto.randomUUID() }));
    resetGeneratedCodeEditor();
    showGeneratedCode.value = true;
    closeActionDialog();
  } catch (error) {
    if (isAbortError(error)) {
      closeActionDialog();
      return;
    }

    const message = error instanceof Error ? error.message : 'AI 生成失败';
    errorMessage.value = message;
    failActionDialog(message);
  } finally {
    if (aiGenerateAbortController === controller) {
      aiGenerateAbortController = null;
    }
    actionDialog.canceling = false;
    isGenerating.value = false;
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
  if (isSavingAppPreset.value) return;
  const editing = Boolean(appPresetForm.id);
  isSavingAppPreset.value = true;
  errorMessage.value = '';
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
    ElMessage.success(editing ? 'App 配置已更新' : 'App 已添加');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'App 配置保存失败';
    void ElMessageBox.alert(message, 'App 配置保存失败', { type: 'error' }).catch(() => {});
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
    if (appPresetForm.id === id) resetAppPresetForm();
  } catch (error) {
    void ElMessageBox.alert(error instanceof Error ? error.message : 'App 配置删除失败', '删除失败', { type: 'error' }).catch(() => {});
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

const configResource = useInitialResource('参数配置', loadConfig);
const presetsResource = useInitialResource('应用预设', loadAppPresets);
const scriptsResource = useInitialResource('脚本列表', loadSavedScripts);
const initialResources = [configResource, presetsResource, scriptsResource];
const failedResources = computed(() => initialResources.filter(resource => resource.error.value));
watch(activeMenu, menu => {
  window.localStorage.setItem(ACTIVE_MENU_STORAGE_KEY, menu);
  visitedMenus.add(menu);
  if (!openMenus.value.includes(menu)) openMenus.value.push(menu);
}, { flush: 'sync' });
const warnBeforeUnload = (event: BeforeUnloadEvent) => {
  if (!appiumAutoSave.dirty.value) return;
  event.preventDefault();
  event.returnValue = '';
};
onMounted(async () => {
  window.addEventListener('beforeunload', warnBeforeUnload);
  try { await migrateLegacySavedScripts(); }
  catch (error) { ElMessage.warning(error instanceof Error ? error.message : '脚本缓存迁移失败'); }
  await Promise.all(initialResources.map(resource => resource.load()));
});
onUnmounted(() => {
  window.removeEventListener('beforeunload', warnBeforeUnload);
  aiGenerateAbortController?.abort();
});
</script>

<template>
  <div class="layout" :class="{ 'layout--collapsed': sidebarCollapsed }">
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
        <div v-if="actionDialog.loading" class="action-dialog__footer-actions">
          <el-button
            v-if="actionDialog.canCancel"
            class="action-dialog__footer-button action-dialog__footer-button--secondary"
            :icon="VideoPause"
            :loading="actionDialog.canceling"
            @click="stopGenerateWithModel"
          >
            {{ actionDialog.cancelText === '终止' ? '终止生成' : actionDialog.cancelText }}
          </el-button>
          <el-button
            v-if="actionDialog.canRunInBackground"
            class="action-dialog__footer-button action-dialog__footer-button--primary"
            @click="sendActionDialogToBackground"
          >
            后台处理
          </el-button>
        </div>
        <el-button
          v-else
          class="action-dialog__footer-button action-dialog__footer-button--primary"
          @click="closeActionDialog"
        >
          关闭
        </el-button>
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

    <AppSidebar :active-menu="activeMenu" :collapsed="sidebarCollapsed"
      @select="selectMenu" />

    <div class="layout-main">
      <header class="layout-header">
        <div class="layout-header__title">
          <el-button text class="layout-collapse" :icon="sidebarCollapsed ? Expand : Fold"
            :aria-label="sidebarCollapsed ? '展开导航' : '收起导航'" :aria-expanded="!sidebarCollapsed"
            @click="sidebarCollapsed = !sidebarCollapsed" />
          <span class="layout-header__breadcrumb">工作空间 <span>/</span></span>
          <span>{{ activeMenuLabel }}</span>
        </div>
        <div class="layout-header__actions">
          <div id="appium-header-actions" v-show="activeMenu === 'appium'"></div>
          <el-button
            v-if="activeMenu === 'generator'"
            type="primary"
            :icon="isGenerating ? Loading : Check"
            :class="{ 'layout-header__button--loading': isGenerating }"
            @click="generateWithModel"
          >
            {{ isGenerating ? 'AI 生成中' : 'AI 生成' }}
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

      <nav class="layout-page-tabs" aria-label="页面导航">
        <div v-for="item in visibleMenuItems" :key="item.key" class="layout-page-tab" :class="{ 'is-active': activeMenu === item.key }">
          <button type="button" class="layout-page-tab__select"
            :aria-current="activeMenu === item.key ? 'page' : undefined" @click="selectMenu(item.key)">
            <el-icon><component :is="item.icon" /></el-icon>{{ item.label }}
          </button>
          <button type="button" class="layout-page-tab__close" :aria-label="`关闭${item.label}页签`"
            :disabled="openMenus.length === 1" :title="openMenus.length === 1 ? '至少保留一个页签' : '关闭页签，编辑状态仍保留'" @click="closeMenu(item.key)">
            <el-icon><Close /></el-icon>
          </button>
        </div>
      </nav>

      <div v-if="connectionError" class="connection-status" role="status">
        <span>{{ connectionError }}</span><el-button link type="primary" :loading="reconnecting" @click="reconnect">重新连接</el-button>
      </div>
      <div v-for="resource in failedResources" :key="resource.name" class="connection-status" role="alert">
        <span>{{ resource.name }}加载失败：{{ resource.error.value }}</span>
        <el-button link type="primary" :loading="resource.loading.value" @click="resource.load">重试</el-button>
      </div>
      <main
        class="page-body"
        :class="{
          'page-body--fixed': activeMenu === 'generator' && activeGeneratorMode === 'ai',
          'page-body--appium': activeMenu === 'appium',
          'page-body--config': activeMenu === 'config',
        }"
      >
        <el-alert v-if="activeMenu !== 'appium' && activeMenu !== 'config' && activeMenu !== 'about' && errorMessage" type="error" :closable="false" show-icon class="page-alert">
          <template #title>{{ errorMessage }}</template>
        </el-alert>

        <AnalysisPage v-if="visitedMenus.has('analysis')" v-show="activeMenu === 'analysis'" :active="activeMenu === 'analysis'" />

        <GeneratorPage
          v-if="visitedMenus.has('generator')"
          v-show="activeMenu === 'generator'"
          v-model:mode="activeGeneratorMode"
          v-model:source-prompt="sourcePrompt"
          v-model:prompt-preset-id="promptPresetId"
          v-model:generated-code-draft="generatedCodeDraft"
          :form="form"
          :app-presets="appPresets"
          :prompt-presets="promptPresets"
          :prompt-example="promptDocument.trim()"
          :steps="steps"
          :generated-code="generatedCode"
          :show-generated-code="showGeneratedCode"
          :generated-code-editing="generatedCodeEditing"
          :generated-code-edit-saving="generatedCodeEditSaving"
          :is-generating="isGenerating"
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

        <div v-if="activeMenu === 'config' && !configReady && !configResource.error.value" class="page-loading" role="status">正在加载参数配置…</div>

        <ConfigPage
          v-if="visitedMenus.has('config') && configReady"
          v-show="activeMenu === 'config'"
          :config-form="configForm"
          :app-presets="appPresets"
          :app-preset-form="appPresetForm"
          :testing-model-key="testingModelKey"
          :is-saving-model-config="isSavingModelConfig"
          :is-saving-app-preset="isSavingAppPreset"
          :model-test-status="modelTestStatus"
          :appium-save-status="appiumAutoSave.status.value"
          :appium-save-failed="appiumAutoSave.failed.value"
          @retry-appium-save="appiumAutoSave.retry"
          @test-model="testModel"
          @save-model-config="saveModelConfig"
          @save-app-preset="saveAppPreset"
          @edit-app-preset="editAppPreset"
          @delete-app-preset="removeAppPreset"
          @cancel-app-preset-edit="resetAppPresetForm"
          @update-midscene-model-provider="updateMidsceneModelProvider"
        />

        <AutomationPage
          v-if="visitedMenus.has('automation')"
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
          v-if="visitedMenus.has('appium')"
          v-show="activeMenu === 'appium'"
          :active="activeMenu === 'appium'"
          :app-presets="appPresets"
          :ai-recognition-model-configured="aiRecognitionModelConfigured"
          :ai-prompt-presets="configForm.appium.aiPromptPresets"
          :report-summary="configForm.appium.reportSummary"
          :flow-background-color="configForm.appium.flowBackgroundColor"
          :flow-line-color="configForm.appium.flowLineColor"
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

        <HelpCenter v-if="visitedMenus.has('about')" v-show="activeMenu === 'about'" :active="activeMenu === 'about'" />
      </main>
    </div>

  </div>
</template>
