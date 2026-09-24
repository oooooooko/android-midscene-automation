import { resolveReportSummary } from '../appium-recorder/report-summary';
import { computed, onScopeDispose, shallowRef, watch } from 'vue';
import type { ConfigForm } from '../types';
import { isHexColor } from '../appium-recorder/flow-appearance';
import { resolveAiDeduplication } from '../appium-recorder/ai-deduplication';

// 串行提交最新快照，较慢的旧请求不会在新请求后覆盖配置。
export function useAppiumAutoSave(config: ConfigForm, save: (value: Omit<ConfigForm['appium'], 'model' | 'promptOptimizer'>) => Promise<unknown>, onError: (error: unknown) => void) {
  const saving = shallowRef(false);
  const status = shallowRef('');
  const saved = shallowRef('');
  const initialized = shallowRef(false);
  const failed = shallowRef(false);
  let pending: string | undefined;
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
  function initialize() { saved.value = snapshotSettings(); initialized.value = true; }
  const dirty = computed(() => initialized.value && snapshotSettings() !== saved.value);
  async function flush() {
    if (saving.value || pending === undefined) return;
    saving.value = true;
    try {
      while (pending !== undefined) {
        const snapshot = pending;
        pending = undefined;
        if (snapshot === saved.value) { status.value = '已自动保存'; continue; }
        status.value = '正在自动保存…';
        try {
          await save(JSON.parse(snapshot));
          saved.value = snapshot;
          failed.value = false;
          if (snapshotSettings() === snapshot) status.value = '已自动保存';
        } catch (error) {
          status.value = '自动保存失败，修改已保留';
          failed.value = true;
          onError(error);
          // 保留失败快照，等待显式重试或下次修改，避免离线时无限请求。
          pending = pending ?? snapshot;
          break;
        }
      }
    } finally { saving.value = false; }
  }
  function queue(snapshot: string) {
    if (!initialized.value) return;
    failed.value = false;
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
  }
  watch(snapshotSettings, queue, { flush: 'sync' });
  function retry() { queue(snapshotSettings()); clearTimeout(timer); return flush(); }
  onScopeDispose(() => { clearTimeout(timer); pending = undefined; });
  return { initialize, saving, status, failed, dirty, retry };
}
