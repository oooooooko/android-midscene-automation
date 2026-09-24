import { reactive, ref, shallowRef } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { resolveReportSummary } from '../appium-recorder/report-summary';
import { isAiRecognitionModelConfigured } from '../appium-recorder/ai-recognition';
import { resolveAiDeduplication } from '../appium-recorder/ai-deduplication';
import { resolveAiPromptPresets } from '../appium-recorder/ai-prompt-presets';
import { normalizeFlowBackground, normalizeFlowLineColor } from '../appium-recorder/flow-appearance';
import { selectMidsceneModelProvider, type MidsceneModelProvider } from './midscene-model-presets';
import { useAppiumAutoSave } from './use-appium-auto-save';
import type { ConfigForm } from '../types';
import * as api from '../api';

export function useModelConfig() {
  const isSavingModelConfig = ref(false);
  const testingModelKey = ref('');
  const modelTestStatus = reactive({
    midscene: '',
    scriptOptimizer: '',
    appium: '',
    promptOptimizer: '',
  });
  const aiRecognitionModelConfigured = shallowRef(false);
  const ready = shallowRef(false);
  const configForm = reactive<ConfigForm>({
    appium: { reportSummary: resolveReportSummary(), model: { baseUrl: '', apiKey: '', name: '' }, promptOptimizer: { model: { baseUrl: '', apiKey: '', name: '' } }, aiDeduplication: resolveAiDeduplication(), screenshotReport: false },
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

  const appiumAutoSave = useAppiumAutoSave(configForm, async value => {
    await api.saveAppiumConfig(value);
  }, error => {
    ElMessage.error(error instanceof Error ? error.message : 'Appium 配置自动保存失败');
  });

  const loadConfig = async () => {
    if (ready.value) return;
    const payload = await api.getConfig();
    Object.assign(configForm.runtime, payload.runtime || {});
    Object.assign(configForm.midscene.model, payload.midscene.model);
    Object.keys(configForm.midscene.env).forEach((key) => {
      delete configForm.midscene.env[key];
    });
    Object.assign(configForm.midscene.env, payload.midscene.env || {});
    Object.assign(configForm.scriptOptimizer.model, payload.scriptOptimizer.model);
    Object.assign(configForm.appium.model, payload.appium?.model || { baseUrl: '', apiKey: '', name: '' });
    Object.assign(configForm.appium.promptOptimizer!.model, payload.appium?.promptOptimizer?.model || { baseUrl: '', apiKey: '', name: '' });
    configForm.appium.screenshotReport = payload.appium?.screenshotReport === true;
    configForm.appium.reportSummary = resolveReportSummary(payload.appium?.reportSummary);
    configForm.appium.aiDeduplication = resolveAiDeduplication(payload.appium?.aiDeduplication);
    configForm.appium.aiPromptPresets = resolveAiPromptPresets(payload.appium?.aiPromptPresets);
    configForm.appium.flowBackgroundColor = normalizeFlowBackground(payload.appium?.flowBackgroundColor);
    configForm.appium.flowLineColor = normalizeFlowLineColor(payload.appium?.flowLineColor);
    appiumAutoSave.initialize();
    ready.value = true;
    aiRecognitionModelConfigured.value = isAiRecognitionModelConfigured(configForm.appium.model);
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
    if (configForm.midscene.model.provider !== 'codex') {
      rememberCustomMidsceneModel();
    }
    Object.assign(configForm.midscene.model, selectMidsceneModelProvider(provider, configForm.midscene.model, lastCustomMidsceneModel));
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
    return `Midscene 模型配置不完整：缺少 ${missing.join('、')}。请在“参数配置 > Midscene配置 > Midscene 模型”中选择“使用 Codex”，或补齐自定义提供方后测试并保存。`;
  };

  const saveModelConfig = async () => {
    if (!ready.value || isSavingModelConfig.value) return;
    isSavingModelConfig.value = true;
    try {
      await api.saveConfig({ runtime: { ...configForm.runtime } });
      ElMessage.success('参数配置已保存');
    } catch (error) {
      const message = error instanceof Error ? error.message : '参数配置保存失败';
      ElMessage.error(message);
    } finally {
      isSavingModelConfig.value = false;
    }
  };

  const testModel = async (key: 'midscene' | 'scriptOptimizer' | 'appium' | 'promptOptimizer') => {
    if (!ready.value || testingModelKey.value) return;
    testingModelKey.value = key;
    modelTestStatus[key] = '';
    const model = { ...(key === 'promptOptimizer'
        ? configForm.appium.promptOptimizer!.model
        : configForm[key].model) };

    try {
      const payload = await api.testModel({ modelKey: key, model, save: true });
      if (!payload.saved) throw new Error('模型未保存，请重试');
      const successMessage = `测试通过，配置已保存${payload.content ? `：${payload.content}` : ''}`;
      modelTestStatus[key] = '';
      if (key === 'appium') aiRecognitionModelConfigured.value = isAiRecognitionModelConfigured(model);
      void ElMessageBox.alert(successMessage, '模型测试成功', {
        type: 'success',
        confirmButtonText: '确定',
      }).catch(() => {});
    } catch (error) {
      modelTestStatus[key] = `未保存：${error instanceof Error ? error.message : '测试失败'}`;
    } finally {
      testingModelKey.value = '';
    }
  };


  return { ready, configForm, appiumAutoSave, isSavingModelConfig, testingModelKey, modelTestStatus, aiRecognitionModelConfigured, loadConfig, updateMidsceneModelProvider, getMidsceneModelConfigError, saveModelConfig, testModel };
}
