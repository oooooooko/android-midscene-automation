import { resolveReportSummary } from '../appium-recorder/report-summary';
import { onScopeDispose, shallowRef, watch } from 'vue';
import type { ConfigForm } from '../types';
import { isHexColor } from '../appium-recorder/flow-appearance';
import { resolveAiDeduplication } from '../appium-recorder/ai-deduplication';

// 串行提交最新快照，较慢的旧请求不会在新请求后覆盖配置。
export function useAppiumAutoSave(config: ConfigForm, save: (value: Omit<ConfigForm['appium'], 'model' | 'promptOptimizer'>) => Promise<unknown>, onError: (error: unknown) => void) {
  const saving = shallowRef(false);
  const status = shallowRef('');
  let initialized = false, saved = '', pending: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // 模型只能通过“测试并保存”提交，自动保存仅观察其余设置。
  function snapshotSettings() {
    const { model: _model, promptOptimizer: _promptOptimizer, reportSummary, ...settings } = config.appium;
    return JSON.stringify({ ...settings, ...(reportSummary ? { reportSummary: {
      enabled: reportSummary.enabled,
      prompt: reportSummary.prompt,
      customPresets: reportSummary.customPresets,
    } } : {}) });
  }
  function initialize() { saved = snapshotSettings(); initialized = true; }
  async function flush() {
    if (saving.value || pending === undefined) return;
    saving.value = true;
    try {
      while (pending !== undefined) {
        const snapshot = pending;
        pending = undefined;
        if (snapshot === saved) { status.value = '已自动保存'; continue; }
        status.value = '正在自动保存…';
        try {
          await save(JSON.parse(snapshot));
          saved = snapshot;
          if (snapshotSettings() === snapshot) status.value = '已自动保存';
        } catch (error) {
          status.value = '自动保存失败，请重新修改后重试';
          onError(error);
          // 不无限重试失败请求；若用户期间有新修改，继续保存最新快照。
        }
      }
    } finally { saving.value = false; }
  }
  watch(snapshotSettings, snapshot => {
    if (!initialized) return;
    clearTimeout(timer);
    pending = undefined;
    const value = config.appium;
    if ((value.flowBackgroundColor !== undefined && !isHexColor(value.flowBackgroundColor))
      || (value.flowLineColor !== undefined && !isHexColor(value.flowLineColor))) {
      status.value = '颜色格式有误，尚未保存';
      return;
    }
    try { resolveAiDeduplication(value.aiDeduplication); resolveReportSummary(value.reportSummary); }
    catch { status.value = '配置参数有误，尚未保存'; return; }
    pending = snapshot;
    status.value = '等待自动保存…';
    timer = setTimeout(() => { void flush(); }, 350);
  }, { flush: 'sync' });
  onScopeDispose(() => { clearTimeout(timer); pending = undefined; });
  return { initialize, saving, status };
}
