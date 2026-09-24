import { shallowRef } from 'vue';

// Retry only a failed resource, so reconnecting never replaces an edited form.
export function useInitialResource(name: string, fetch: () => Promise<unknown>) {
  const loading = shallowRef(false);
  const error = shallowRef('');
  const ready = shallowRef(false);
  async function load() {
    if (loading.value || ready.value) return;
    loading.value = true;
    error.value = '';
    try { await fetch(); ready.value = true; }
    catch (reason) { error.value = reason instanceof Error ? reason.message : '请检查服务连接后重试'; }
    finally { loading.value = false; }
  }
  return { name, loading, error, ready, load };
}
