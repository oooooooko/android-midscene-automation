import { computed, ref, shallowRef, onScopeDispose, type Ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import * as api from '../api';
import type { SavedScript, ExecutionStep, RunScriptStreamEvent } from '../types';

export function useScriptExecution(selectedScript: Ref<SavedScript | undefined>, selectedScriptId: Ref<string>, playgroundDeviceId: Ref<string>, loadSavedScripts: (id?: string) => Promise<void>, getMidsceneModelConfigError: () => string) {
  const isRunningScript = ref(false);
  const isStoppingScript = ref(false);
  const executionLog = ref('');
  const executionProcess = ref<ExecutionStep[]>([]);
  const lastRunStatus = ref('');
  const runStartedAt = shallowRef<number | null>(null);
  const runningElapsedNow = shallowRef(0);
  let executionProgressTimer: number | null = null;
  let scriptRunAbortController: AbortController | null = null;
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


  onScopeDispose(() => { stopExecutionProgressTimer(); scriptRunAbortController?.abort(); });
  return { isRunningScript, isStoppingScript, executionLog, executionProcess, lastRunStatus, runningElapsedText, runSelectedScript, stopSelectedScript };
}
