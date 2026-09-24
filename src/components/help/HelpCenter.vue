<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import { InfoFilled, QuestionFilled, Tools, Refresh, Monitor, Cpu, Cellphone } from '@element-plus/icons-vue';
import { getAppiumVersion } from '../../api';
import type { AppiumVersionInfo } from '../../types';
import changelog from '../../../CHANGELOG.md?raw';
import faq from '../../../FAQ.md?raw';
import aiRecognitionGuide from '../../../AI识别操作说明.md?raw';
import appiumGuide from '../../../流程节点操作说明.md?raw';
import operationGuide from '../../../USAGE.md?raw';
import packageText from '../../../package.json?raw';
import MarkdownDocument from './MarkdownDocument.vue';

type PackageInfo = { version?: string; dependencies?: Record<string, string> };
type OperationSection = { id: string; title: string; content: string };

const props = defineProps<{ active: boolean }>();
const appiumVersion = shallowRef<AppiumVersionInfo | null>(null);
const loadingVersion = shallowRef(false);
const versionError = shallowRef('');
let checkedAt = 0;
async function refreshVersion(force = true) {
  if (!force && Date.now() - checkedAt < 60_000) return;
  if (loadingVersion.value) return;
  loadingVersion.value = true;
  versionError.value = '';
  try {
    appiumVersion.value = await getAppiumVersion();
    checkedAt = Date.now();
  } catch {
    versionError.value = '无法读取版本信息，请检查后端连接后刷新';
  } finally {
    loadingVersion.value = false;
  }
}
watch(() => props.active, active => { if (active) void refreshVersion(false); }, { immediate: true });

const activeTab = shallowRef('about');
type OperationType = 'midscene' | 'appium' | 'aiRecognition' | 'faq';

const operationType = shallowRef<OperationType>('midscene');
const activeOperation = shallowRef('');
const packageInfo = JSON.parse(packageText) as PackageInfo;
const dependencyVersion = (name: string) => packageInfo.dependencies?.[name]?.match(/(\d+\.\d+\.\d+)/)?.[1] ?? '未知';
const appVersion = packageInfo.version ?? '未知';
const midsceneVersion = dependencyVersion('@midscene/core');

const versions = computed(() => [
  { name: '应用版本', version: `v${appVersion}`, description: '移动自动化控制台', icon: Monitor },
  { name: 'Midscene', version: `v${midsceneVersion}`, description: 'AI 驱动的界面理解与自动化', icon: Cpu },
  { name: 'Appium', version: appiumVersion.value?.version ? `v${appiumVersion.value.version}` : loadingVersion.value ? '检测中…' : '未获取',
    description: loadingVersion.value ? '正在读取当前环境版本' : versionError.value || appiumVersion.value?.message || '等待检测', icon: Cellphone },
]);

const technologies = computed(() => [
  { name: 'Vue', version: dependencyVersion('vue'), description: '界面与交互框架' },
  { name: 'Element Plus', version: dependencyVersion('element-plus'), description: '界面组件库' },
  { name: 'Vue Flow', version: dependencyVersion('@vue-flow/core'), description: 'Appium 流程画布' },
  { name: 'OpenCV.js', version: dependencyVersion('@techstark/opencv-js'), description: '本地图像检测' },
  { name: 'Vite', version: dependencyVersion('vite'), description: '开发与构建工具' },
  { name: 'TypeScript', version: dependencyVersion('typescript'), description: '类型与工程开发语言' },
]);

const extractOperationSections = (startHeading: string, endHeading: string) => {
  const start = operationGuide.indexOf(`## ${startHeading}`);
  const end = operationGuide.indexOf(`## ${endHeading}`, start + 1);
  if (start < 0) return [];
  const source = operationGuide.slice(start, end < 0 ? undefined : end);
  const matches = [...source.matchAll(/^###\s+(.+)$/gm)];
  return matches.map<OperationSection>((match, index) => ({
    id: `${startHeading}-${index}`,
    title: match[1]!.trim(),
    content: source.slice(match.index! + match[0].length, matches[index + 1]?.index).trim(),
  }));
};

const extractDocumentSections = (source: string, prefix: string) => {
  const matches = [...source.matchAll(/^##\s+(.+)$/gm)];
  return matches.map<OperationSection>((match, index) => ({
    id: `${prefix}-${index}`,
    title: match[1]!.trim(),
    content: source.slice(match.index! + match[0].length, matches[index + 1]?.index).trim(),
  }));
};

const midsceneOperations = computed(() => extractOperationSections('Midscene 操作说明', 'Appium 使用前准备'));
const appiumOperations = computed(() => extractDocumentSections(appiumGuide, 'appium'));
const aiRecognitionOperations = computed(() => extractDocumentSections(aiRecognitionGuide, 'ai-recognition'));
const faqOperations = computed(() => extractDocumentSections(faq, 'faq'));
const visibleOperations = computed(() => {
  if (operationType.value === 'midscene') return midsceneOperations.value;
  if (operationType.value === 'appium') return appiumOperations.value;
  if (operationType.value === 'aiRecognition') return aiRecognitionOperations.value;
  return faqOperations.value;
});

const switchOperationType = (value: OperationType) => {
  operationType.value = value;
  activeOperation.value = '';
};
</script>

<template>
  <section class="help-center-page" aria-label="关于">
    <el-tabs v-model="activeTab" class="help-center">
      <el-tab-pane name="about">
        <template #label><el-icon><InfoFilled /></el-icon><span>关于</span></template>
        <div class="help-center__content">
          <div class="help-center__version-heading">
            <h2>版本信息</h2>
            <el-button text :icon="Refresh" :loading="loadingVersion" @click="refreshVersion(true)">刷新版本</el-button>
          </div>
          <div class="help-center__versions" aria-live="polite" :aria-busy="loadingVersion">
            <article v-for="item in versions" :key="item.name" class="help-center__version-card">
              <div class="help-center__version-label"><el-icon><component :is="item.icon" /></el-icon><span>{{ item.name }}</span></div>
              <strong>{{ item.version }}</strong>
              <p>{{ item.description }}</p>
            </article>
          </div>
          <h3 class="help-center__section-title">技术栈</h3>
          <div class="help-center__technology-grid">
            <div v-for="item in technologies" :key="item.name" class="help-center__technology">
              <div><strong>{{ item.name }}</strong><el-tag size="small" effect="plain">{{ item.version }}</el-tag></div>
              <p>{{ item.description }}</p>
            </div>
          </div>
        </div>
      </el-tab-pane>
      <el-tab-pane name="guide">
        <template #label><el-icon><QuestionFilled /></el-icon><span>操作说明</span></template>
        <div class="help-center__operations">
          <el-radio-group :model-value="operationType" class="help-center__operation-types" @change="switchOperationType">
            <el-radio-button value="midscene">Midscene</el-radio-button>
            <el-radio-button value="appium">Appium</el-radio-button>
            <el-radio-button value="aiRecognition">AI 识别</el-radio-button>
            <el-radio-button value="faq">常见问题</el-radio-button>
          </el-radio-group>
          <el-collapse v-model="activeOperation" accordion class="help-center__operation-menu">
            <el-collapse-item v-for="item in visibleOperations" :key="item.id" :name="item.id">
              <template #title><span class="help-center__operation-title">{{ item.title }}</span></template>
              <MarkdownDocument :content="item.content" />
            </el-collapse-item>
          </el-collapse>
        </div>
      </el-tab-pane>
      <el-tab-pane name="changelog">
        <template #label><el-icon><Tools /></el-icon><span>更新记录</span></template>
        <div class="help-center__document"><MarkdownDocument :content="changelog" /></div>
      </el-tab-pane>
    </el-tabs>
  </section>
</template>

<style scoped>
.help-center-page { padding: 12px 24px 24px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); background: var(--ui-surface); }

.help-center :deep(.el-tabs__header) { margin-bottom: 0; }
.help-center :deep(.el-tabs__item) { display: inline-flex; align-items: center; gap: 6px; }
.help-center__content,
.help-center__document { padding: 22px 6px 18px 2px; }
.help-center__version-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.help-center__version-heading h2 { margin: 0; font-size: 17px; font-weight: 600; }
.help-center__versions { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; }
.help-center__version-card { min-width: 0; padding: 20px; border: 1px solid var(--ui-border); border-radius: 10px; background: var(--ui-surface); }
.help-center__version-label { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; color: var(--ui-text-secondary); font-size: 14px; }
.help-center__version-label .el-icon { padding: 8px; box-sizing: content-box; border-radius: 8px; background: var(--el-color-primary-light-9); color: var(--ui-primary); font-size: 18px; }
.help-center__version-card strong { display: block; color: var(--ui-text); font-size: 28px; font-weight: 600; line-height: 1.3; overflow-wrap: anywhere; }
.help-center__version-card p { margin: 10px 0 0; color: var(--ui-text-secondary); font-size: 12px; line-height: 1.6; }
.help-center__section-title { margin: 24px 0 12px; color: var(--ui-text); font-size: 17px; }
.help-center__technology-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.help-center__technology { padding: 14px 16px; border: 1px solid var(--ui-border); border-radius: 9px; background: #fff; }
.help-center__technology > div { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.help-center__technology p { margin: 6px 0 0; color: var(--ui-text-secondary); font-size: 13px; }
.help-center__operations { padding: 18px 6px 18px 2px; }
.help-center__operation-types { margin-bottom: 16px; }
.help-center__operation-menu { border-top: 1px solid var(--ui-border); }
.help-center__operation-title { color: var(--ui-text); font-size: 14px; font-weight: 600; }
.help-center__operation-menu :deep(.el-collapse-item__header) { min-height: 48px; padding: 0 14px; border-right: 1px solid var(--ui-border); border-left: 1px solid var(--ui-border); }
.help-center__operation-menu :deep(.el-collapse-item__wrap) { border-right: 1px solid var(--ui-border); border-left: 1px solid var(--ui-border); }
.help-center__operation-menu :deep(.el-collapse-item__content) { padding: 4px 18px 18px; }
@media (max-width: 760px) {
  .help-center__versions,
  .help-center__technology-grid { grid-template-columns: 1fr; }
}
</style>
