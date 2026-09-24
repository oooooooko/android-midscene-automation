import { ref, shallowRef, reactive, watch, onMounted, onScopeDispose, type Ref } from 'vue';
import * as api from '../api';
import type { AndroidDevice, MenuKey } from '../types';

export function useDevicePreview(activeMenu: Ref<MenuKey>) {
  const connectionError = shallowRef('');
  const reconnecting = shallowRef(false);
  const playgroundAvailable = ref(false);
  const playgroundPreviewError = ref('');
  const playgroundDeviceId = ref('');
  const playgroundFrameUrl = ref('');
  const playgroundFrameSignature = ref('');
  const restartingPlaygroundPreview = shallowRef(false);
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
  let playgroundPollTimer: number | null = null;
  let devicePreviewTimer: number | null = null;

  const isBackendFetchError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error || '');
    return error instanceof TypeError || /Failed to fetch|NetworkError|Load failed/i.test(message);
  };

  const stopPlaygroundPollTimer = () => {
    if (!playgroundPollTimer) return;
    window.clearInterval(playgroundPollTimer);
    playgroundPollTimer = null;
  };

  const loadAndroidDevices = async () => {
    try {
      const payload = await api.getAndroidDevices();
      backendOffline.value = false;
      connectionError.value = "";
      androidDevices.value = payload.devices || [];
      playgroundDeviceId.value = payload.currentDeviceId || '';
      playgroundAvailable.value = androidDevices.value.some((item) => item.status === 'device');
    } catch (error) {
      if (isBackendFetchError(error)) {
        markBackendOffline();
        return;
      }
      connectionError.value = error instanceof Error ? error.message : '读取设备列表失败';
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
      playgroundFrameUrl.value = '';
      devicePreviewUrl.value = '';
      devicePreviewMode.value = '';
      return;
    }

    playgroundFrameUrl.value = '';
    devicePreviewUrl.value = `${api.APP_BASE}/api/android-preview?deviceId=${encodeURIComponent(playgroundDeviceId.value)}&t=${Date.now()}`;
    devicePreviewMode.value = 'screenshot';
  };

  const refreshAdbPreviewAfterInput = () => {
    if (devicePreviewMode.value === 'screenshot' && devicePreviewUrl.value) {
      window.setTimeout(loadAdbPreview, 120);
    }
  };

  const refreshDevicePreview = async () => {
    if (devicePreviewMode.value === 'stream' && playgroundDeviceId.value) {
      if (restartingPlaygroundPreview.value) return;
      restartingPlaygroundPreview.value = true;
      playgroundFrameUrl.value = '';
      playgroundFrameSignature.value = '';
      try {
        await api.restartPlaygroundPreview({ deviceId: playgroundDeviceId.value });
        restartingPlaygroundPreview.value = false;
        await loadPlaygroundStatus();
      } catch (error) {
        playgroundPreviewError.value = error instanceof Error ? error.message : '重启实时预览失败';
      } finally {
        restartingPlaygroundPreview.value = false;
      }
      return;
    }
    loadAdbPreview();
  };

  const startDevicePreviewTimer = () => {
    if (backendOffline.value) return;
    if (devicePreviewTimer) return;
    loadAdbPreview();
    devicePreviewTimer = window.setInterval(loadAdbPreview, 1000);
  };

  const stopDevicePreviewTimer = () => {
    if (!devicePreviewTimer) return;
    window.clearInterval(devicePreviewTimer);
    devicePreviewTimer = null;
  };

  const markBackendOffline = () => {
    if (backendOffline.value) return;
    backendOffline.value = true;
    playgroundAvailable.value = false;
    playgroundFrameUrl.value = '';
    playgroundFrameSignature.value = '';
    devicePreviewUrl.value = '';
    devicePreviewMode.value = '';
    playgroundPreviewError.value = '本地服务已断开，正在尝试重连。恢复连接后可继续编辑。';
    connectionError.value = playgroundPreviewError.value;
    stopDevicePreviewTimer();
  };

  const loadPlaygroundStatus = async () => {
    if (backendOffline.value || restartingPlaygroundPreview.value) return;
    if (!playgroundDeviceId.value) {
      stopDevicePreviewTimer();
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
      if (restartingPlaygroundPreview.value) return;
      const payload = await api.getPlaygroundStatus();
      if (restartingPlaygroundPreview.value) return;

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
        stopDevicePreviewTimer();
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
        if (activeMenu.value === 'appium' || activeMenu.value === 'automation') startDevicePreviewTimer();
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
      if (activeMenu.value === 'appium' || activeMenu.value === 'automation') startDevicePreviewTimer();
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


  const reconnect = async () => {
    if (reconnecting.value) return;
    reconnecting.value = true;
    try { await loadAndroidDevices(); await loadPlaygroundStatus(); }
    finally { reconnecting.value = false; }
  };
  watch(activeMenu, () => {
    stopDevicePreviewTimer();
    if (activeMenu.value === 'appium' || activeMenu.value === 'automation') void loadPlaygroundStatus();
  });
  onMounted(() => {
    void reconnect();
    playgroundPollTimer = window.setInterval(() => { void reconnect(); }, 5000);
  });
  onScopeDispose(() => { stopPlaygroundPollTimer(); stopDevicePreviewTimer(); });
  return { backendOffline, connectionError, reconnecting, reconnect, playgroundAvailable, playgroundPreviewError, playgroundDeviceId, playgroundFrameUrl, devicePreviewUrl, androidDevices, deviceInterfaceSize, refreshDevicePreview, tapDevice, swipeDevice, switchAndroidDevice, triggerDeviceKey };
}
