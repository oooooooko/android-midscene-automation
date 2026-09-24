<script setup lang="ts">
import { computed, inject, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { Loading, QuestionFilled } from '@element-plus/icons-vue';
import { isAiBranchEnabled, validateAiRecognitionPrompt, DEFAULT_AI_OBSERVATION, validateAiObservation, type AiObservationConfig } from '../ai-recognition';
import { optimizeAppiumPrompt, validateAiBranchQuestion } from '../api';
import { flowBranchLabel } from '../flow-labels';
import type { AppiumRecordedStep } from '../types';
import { aiPromptPresetsKey, DEFAULT_AI_PROMPT_PRESETS } from '../ai-prompt-presets';
import AiRecognitionPromptInput from './AiRecognitionPromptInput.vue';

const props = defineProps<{ step: AppiumRecordedStep; steps: AppiumRecordedStep[]; disabled?: boolean }>();
const emit = defineEmits<{ update: [patch: Partial<AppiumRecordedStep>] }>();
const prompt = ref(props.step.value || '');
const promptPresets = inject(aiPromptPresetsKey, ref(DEFAULT_AI_PROMPT_PRESETS));
const busy = ref(false);
const optimizingPrompt = shallowRef(false);
const error = ref('');
const branch = computed(() => isAiBranchEnabled(props.step));
const untilMatch = computed(() => props.step.aiObservation?.mode === 'untilMatch');
const branchChoice = ref(branch.value);
const fallbackEnabled = shallowRef(Boolean(props.step.aiInvalidResultBranch));
watch(branch, value => { branchChoice.value = value; });
watch(() => props.step.aiInvalidResultBranch, value => { fallbackEnabled.value = Boolean(value); });
let controller: AbortController | undefined;
let optimizeController: AbortController | undefined;
watch(() => props.step.value, value => { prompt.value = value || ''; });
onBeforeUnmount(() => { controller?.abort(); optimizeController?.abort(); });

function updateObservation(patch: Partial<AiObservationConfig>) {
  try {
    const aiObservation = validateAiObservation({ ...DEFAULT_AI_OBSERVATION, ...props.step.aiObservation, ...patch });
    error.value = '';
    emit('update', { aiObservation });
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '持续观察配置无效'; }
}

async function toggleBranch(enabled: boolean) {
  branchChoice.value = enabled;
  await save(enabled);
  branchChoice.value = branch.value;
}

function toggleFallback(enabled: boolean) {
  fallbackEnabled.value = enabled;
  error.value = '';
  if (!enabled) emit('update', { aiInvalidResultBranch: undefined });
}

async function optimizePrompt() {
  if (busy.value || optimizingPrompt.value || props.disabled) return;
  error.value = '';
  optimizeController = new AbortController();
  optimizingPrompt.value = true;
  let optimized = '';
  try {
    optimized = (await optimizeAppiumPrompt({
      kind: 'aiRecognition',
      prompt: prompt.value,
      condition: branch.value || untilMatch.value,
    }, optimizeController.signal)).prompt;
    prompt.value = optimized;
  } catch (cause) {
    if (!optimizeController.signal.aborted) error.value = cause instanceof Error ? cause.message : '提示词优化失败';
  } finally {
    optimizingPrompt.value = false;
  }
  if (optimized) await save(branch.value);
}

async function save(enabled: boolean, observation?: AiObservationConfig) {
  if (busy.value || props.disabled) return;
  error.value = '';
  if (!enabled && branch.value && (props.step.flow?.yesTargetId || props.step.flow?.noTargetId
    || props.steps.some(step => step.flow?.parentConditionId === props.step.id))) {
    error.value = '请先移除当前 AI 节点的子分支，再关闭分支模式';
    return;
  }
  controller = new AbortController();
  const signal = controller.signal;
  busy.value = true;
  try {
    const value = validateAiRecognitionPrompt(prompt.value);
    if (enabled || (observation ?? props.step.aiObservation)?.mode === 'untilMatch') {
      const validation = await validateAiBranchQuestion(value, signal);
      if (!validation.result) throw new Error(`${enabled ? '无法进入分支' : '命中条件无效'}：${validation.reason || '请填写可用 true/false 判断的问题'}`);
    }
    if (signal.aborted) return;
    emit('update', { value, aiBranchEnabled: enabled, ...(observation ? { aiObservation: observation } : {}), flow: { ...props.step.flow, nodeKind: enabled ? 'condition' : 'action' } });
  } catch (cause) {
    if (!signal.aborted) error.value = `${cause instanceof Error ? cause.message : '问题验证失败'}（未保存本次修改）`;
  } finally { busy.value = false; }
}
</script>

<template>
  <el-form-item label="识别方式">
    <template #label>
      <span class="recognition-label">识别方式
        <el-tooltip placement="top" :show-after="200">
          <template #content><div class="recognition-help-content">单帧识别：截取当前画面并分析。持续观察：按采样间隔连续截图，判断目标是否在观察期间出现过。建议紧接启动 App 或触发广告的操作放置本节点。</div></template>
          <el-button class="recognition-help" text :icon="QuestionFilled" aria-label="识别方式说明" @click.prevent />
        </el-tooltip>
      </span>
    </template>
    <el-radio-group :model-value="Boolean(step.aiObservation)" :disabled="disabled || busy" @update:model-value="emit('update', { aiObservation: $event ? { ...DEFAULT_AI_OBSERVATION } : undefined }); error = ''">
      <el-radio-button :value="false">单帧识别</el-radio-button>
      <el-radio-button :value="true">持续观察</el-radio-button>
    </el-radio-group>
  </el-form-item>
  <template v-if="step.aiObservation">
    <el-form-item label="观察模式">
      <template #label>
        <span class="recognition-label">观察模式
          <el-tooltip placement="top" :show-after="200">
            <template #content>
              <div class="recognition-help-content">
                <p>观察结束后统一分析：完成采样后，将保留的截图一次提交给模型。</p>
                <p>检测命中后提前结束：采样期间逐次识别，确认命中后停止观察并执行下一节点；启用分支时走“是”分支。达到最长观察时间后停止采样，等待剩余关键帧判断，未命中则继续下一节点或走“否”分支。</p>
                <p>最多采样 30 帧，实际速度取决于设备，截图按去重配置保留。观察时长与模型请求超时分别计时；提前结束模式可能多次调用模型，实际结束时间包含模型等待，识别错误不会视为未命中。</p>
              </div>
            </template>
            <el-button class="recognition-help" text :icon="QuestionFilled" aria-label="观察模式说明" @click.prevent />
          </el-tooltip>
        </span>
      </template>
      <el-radio-group :model-value="step.aiObservation.mode ?? 'batch'" :disabled="disabled || busy" @update:model-value="$event === 'untilMatch' ? save(branch, { ...step.aiObservation!, mode: 'untilMatch' }) : updateObservation({ mode: 'batch' })">
        <el-radio-button value="batch">观察结束后统一分析</el-radio-button>
        <el-radio-button value="untilMatch">检测命中后提前结束</el-radio-button>
      </el-radio-group>
    </el-form-item>
    <el-form-item :label="untilMatch ? '最长观察时间 ms' : '观察时长 ms'">
      <el-input-number :model-value="step.aiObservation.durationMs" :min="1000" :max="60000" :step="1000" :disabled="disabled || busy" controls-position="right" @change="updateObservation({ durationMs: $event })" />
    </el-form-item>
    <el-form-item label="采样间隔 ms">
      <el-input-number :model-value="step.aiObservation.intervalMs" :min="500" :max="10000" :step="500" :disabled="disabled || busy" controls-position="right" @change="updateObservation({ intervalMs: $event })" />
    </el-form-item>
  </template>
  <el-form-item :label="untilMatch ? '命中条件' : '识别内容'">
    <template #label>
      <span class="recognition-label">{{ untilMatch ? '命中条件' : '识别内容' }}
        <el-tooltip v-if="untilMatch" placement="top" :show-after="200">
          <template #content><div class="recognition-help-content">填写能用“是 / 否”判断的具体条件，例如“当前画面是否出现广告弹窗？”。模型判断为“是”即命中并提前结束观察；修改条件后需验证并保存。“广告内容是什么”等开放式问题请使用统一分析模式。</div></template>
          <el-button class="recognition-help" text :icon="QuestionFilled" aria-label="命中条件说明" @click.prevent />
        </el-tooltip>
      </span>
    </template>
    <AiRecognitionPromptInput v-model="prompt" :presets="promptPresets" :placeholder="untilMatch ? '例如：当前画面是否出现广告弹窗？' : ''" :disabled="disabled || busy || optimizingPrompt" @change="error = ''; !branch && !untilMatch && save(false)" />
    <div class="recognition-prompt-actions">
      <el-button :loading="optimizingPrompt" :disabled="disabled || busy || !prompt.trim()" @click="optimizePrompt">优化提示词</el-button>
      <el-button v-if="(branch || untilMatch) && prompt !== step.value" :disabled="disabled || busy || optimizingPrompt" @click="save(branch)">验证并保存问题</el-button>
    </div>
  </el-form-item>
  <el-form-item>
    <el-checkbox :model-value="branchChoice" :disabled="disabled || busy" @update:model-value="toggleBranch($event === true)">启用分支</el-checkbox>
    <span v-if="busy" class="validation-status" role="status">
      <el-icon class="is-loading" aria-hidden="true"><Loading /></el-icon>
      正在验证…
    </span>
  </el-form-item>
  <el-form-item v-if="branch">
    <el-checkbox :model-value="fallbackEnabled" :disabled="disabled || busy" @update:model-value="toggleFallback($event === true)">启用兜底</el-checkbox>
    <el-tooltip placement="top" :show-after="200">
      <template #content><div class="recognition-help-content">仅在模型返回空内容、无效格式、无法判断或没有返回 true/false 时生效。正常返回布尔结果时仍按识别结果进入分支；请求失败和超时不使用此兜底。</div></template>
      <el-button class="recognition-help" text :icon="QuestionFilled" aria-label="AI 识别兜底说明" @click.prevent />
    </el-tooltip>
  </el-form-item>
  <el-form-item v-if="branch && fallbackEnabled" label="兜底分支">
    <el-select
      :model-value="step.aiInvalidResultBranch || ''"
      :disabled="disabled || busy"
      placeholder="请选择左右分支"
      @update:model-value="emit('update', { aiInvalidResultBranch: $event })"
    >
      <el-option :label="`进入左侧分支（${flowBranchLabel(step, 'yes')}）`" value="yes" />
      <el-option :label="`进入右侧分支（${flowBranchLabel(step, 'no')}）`" value="no" />
    </el-select>
  </el-form-item>
  <el-alert v-if="error" :title="error" type="warning" :closable="false" show-icon />
</template>

<style scoped>
.recognition-label { display: inline-flex; align-items: center; gap: 4px; }
.recognition-help { width: 28px; height: 28px; padding: 0; font-size: 16px; }
.recognition-help-content { max-width: min(360px, calc(100vw - 40px)); line-height: 1.6; overflow-wrap: anywhere; }
.recognition-help-content p { margin: 0 0 8px; }
.recognition-help-content p:last-child { margin-bottom: 0; }
.recognition-prompt-actions { display: flex; justify-content: flex-end; width: 100%; margin-top: 10px; }
.validation-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: 8px;
}
</style>
