<script setup lang="ts">
import { shallowRef } from 'vue';
import BaseConfigPanel from '../components/config/BaseConfigPanel.vue';
import MidsceneConfigPanel from '../components/config/MidsceneConfigPanel.vue';
import AppiumConfigPanel from '../components/config/AppiumConfigPanel.vue';
import type { MidsceneModelProvider } from '../config/midscene-model-presets';
import type { AppPreset, ConfigForm } from '../types';

defineProps<{
  configForm: ConfigForm;
  appPresets: AppPreset[];
  appPresetForm: Pick<AppPreset, 'id' | 'name' | 'packageName'>;
  testingModelKey: string;
  isSavingModelConfig: boolean;
  isSavingAppPreset: boolean;
  modelTestStatus: { midscene: string; scriptOptimizer: string; appium?: string };
}>();

defineEmits<{
  testModel: [key: 'midscene' | 'scriptOptimizer' | 'appium'];
  saveModelConfig: [];
  saveAppPreset: [];
  editAppPreset: [app: AppPreset];
  deleteAppPreset: [id: string];
  updateMidsceneModelProvider: [provider: MidsceneModelProvider];
}>();

const tabs = [
  { name: 'basic', label: '基础配置' },
  { name: 'midscene', label: 'Midscene配置' },
  { name: 'appium', label: 'Appium配置' },
] as const;
const activeTab = shallowRef<(typeof tabs)[number]['name']>('basic');

function handleTabKeydown(event: KeyboardEvent, index: number) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
    : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  activeTab.value = tabs[nextIndex].name;
  (event.currentTarget as HTMLElement).parentElement
    ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
}
</script>

<template>
  <div class="config-page">
    <div class="subnav config-tabs" role="tablist" aria-label="参数配置分类">
      <button
        v-for="(tab, index) in tabs"
        :id="`config-tab-${tab.name}`"
        :key="tab.name"
        type="button"
        role="tab"
        class="subnav__item"
        :class="{ 'subnav__item--active': activeTab === tab.name }"
        :aria-selected="activeTab === tab.name"
        :aria-controls="`config-panel-${tab.name}`"
        :tabindex="activeTab === tab.name ? 0 : -1"
        @click="activeTab = tab.name"
        @keydown="handleTabKeydown($event, index)"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- 保留表单实例，切换分类时不重置编辑状态和正在进行的模型测试。 -->
    <section
      v-show="activeTab === 'basic'"
      id="config-panel-basic"
      role="tabpanel"
      aria-labelledby="config-tab-basic"
    >
      <BaseConfigPanel
        :config-form="configForm"
        :app-presets="appPresets"
        :app-preset-form="appPresetForm"
        :is-saving-model-config="isSavingModelConfig"
        :is-saving-app-preset="isSavingAppPreset"
        @save-model-config="$emit('saveModelConfig')"
        @save-app-preset="$emit('saveAppPreset')"
        @edit-app-preset="$emit('editAppPreset', $event)"
        @delete-app-preset="$emit('deleteAppPreset', $event)"
      />
    </section>

    <section
      v-show="activeTab === 'midscene'"
      id="config-panel-midscene"
      role="tabpanel"
      aria-labelledby="config-tab-midscene"
    >
      <MidsceneConfigPanel
        :config-form="configForm"
        :testing-model-key="testingModelKey"
        :is-saving-model-config="isSavingModelConfig"
        :model-test-status="modelTestStatus"
        @test-model="$emit('testModel', $event)"
        @save-model-config="$emit('saveModelConfig')"
        @update-midscene-model-provider="$emit('updateMidsceneModelProvider', $event)"
      />
    </section>

    <section
      v-show="activeTab === 'appium'"
      id="config-panel-appium"
      role="tabpanel"
      aria-labelledby="config-tab-appium"
    >
      <AppiumConfigPanel
        :config-form="configForm"
        :testing-model-key="testingModelKey"
        :is-saving-model-config="isSavingModelConfig"
        :test-status="modelTestStatus.appium"
        @test-model="$emit('testModel', 'appium')"
        @save-model-config="$emit('saveModelConfig')"
      />
    </section>
  </div>
</template>

<style scoped>
.config-tabs {
  max-width: 100%;
  flex-wrap: wrap;
}

@media (max-width: 640px) {
  :deep(.config-model-grid) {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
