<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import { InfoFilled, QuestionFilled, Tools, Refresh, Cpu, Cellphone } from '@element-plus/icons-vue';
import { getAppiumVersion, getArtemisVersion } from '../../api';
import type { AppiumVersionInfo } from '../../types';
import changelog from '../../../CHANGELOG.md?raw';
import faq from '../../../FAQ.md?raw';
import aiRecognitionGuide from '../../../AI识别操作说明.md?raw';
import appiumGuide from '../../../流程节点操作说明.md?raw';
import operationGuide from '../../../USAGE.md?raw';
import packageText from '../../../package.json?raw';
import MarkdownDocument from './MarkdownDocument.vue';

type PackageInfo = { dependencies?: Record<string, string> };
type OperationSection = { id: string; title: string; content: string };

const props = defineProps<{ active: boolean }>();
const appiumVersion = shallowRef<AppiumVersionInfo | null>(null);
const artemisVersion = shallowRef<Awaited<ReturnType<typeof getArtemisVersion>> | null>(null);
const artemisVersionError = shallowRef('');
const loadingVersion = shallowRef(false);
const versionError = shallowRef('');
let checkedAt = 0;
async function refreshVersion(force = true) {
  if (!force && Date.now() - checkedAt < 60_000) return;
  if (loadingVersion.value) return;
  loadingVersion.value = true;
  versionError.value = '';
  artemisVersionError.value = '';
  try {
    const [appium, artemis] = await Promise.allSettled([getAppiumVersion(), getArtemisVersion()]);
    if (appium.status === 'fulfilled') appiumVersion.value = appium.value;
    else {
      appiumVersion.value = null;
      versionError.value = '无法读取 Appium 版本，请检查后端连接后刷新';
    }
    if (artemis.status === 'fulfilled') artemisVersion.value = artemis.value;
    else {
      artemisVersion.value = null;
      artemisVersionError.value = '无法读取 Artemis 版本，请检查后端连接后刷新';
    }
    if (appium.status === 'fulfilled' && artemis.status === 'fulfilled') checkedAt = Date.now();
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
const midsceneVersion = dependencyVersion('@midscene/core');

const versions = computed(() => [
  { name: 'Midscene', version: `v${midsceneVersion}`, status: '当前项目依赖版本', icon: Cpu,
    description: '通过视觉模型理解界面，用自然语言完成操作、数据提取与断言，减少对固定元素定位的依赖。',
    scenarios: ['自然语言编写测试步骤', '界面内容识别与智能断言', '快速验证 Android 操作流程'],
    integration: '本项目保留脚本生成与自动化功能，已停止日常维护，建议使用官方版本。',
    url: 'https://midscenejs.com/zh/' },
  { name: 'Appium', version: appiumVersion.value?.version ? `v${appiumVersion.value.version}` : loadingVersion.value ? '检测中…' : '未获取',
    status: loadingVersion.value ? '正在读取当前环境版本' : versionError.value || appiumVersion.value?.message || '等待检测', icon: Cellphone,
    description: '基于 WebDriver 协议和平台驱动的开源 UI 自动化框架，可通过元素定位和明确的操作步骤执行测试。',
    scenarios: ['固定步骤的重复回归测试', '需要精确定位与流程控制的测试', '长期维护、重复执行的测试脚本'],
    integration: '本项目提供 Android 录制、流程编排、脚本回放与执行报告。',
    url: 'https://appium.io/' },
  { name: 'Artemis', version: artemisVersion.value?.version ? `v${artemisVersion.value.version}` : loadingVersion.value ? '检测中…' : '未获取',
    status: loadingVersion.value ? '正在读取本地源码版本' : artemisVersionError.value || artemisVersion.value?.message || '等待检测', icon: Cpu,
    description: '面向 Android 的 AI 自动化工具，根据自然语言任务规划并执行操作，支持跨应用工作流和执行日志记录。',
    scenarios: ['用任务目标描述端到端流程', '跨应用操作与探索性任务', '与 AI 编程助手配合验证移动应用'],
    integration: '本项目嵌入独立控制台，模型、设备及任务在 Artemis 中单独配置。',
    url: 'https://github.com/google/artemis' },
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
              <p class="help-center__version-status">{{ item.status }}</p>
              <div class="help-center__framework-details">
                <h3>框架简介</h3>
                <p>{{ item.description }}</p>
                <h3>适合场景</h3>
                <ul><li v-for="scenario in item.scenarios" :key="scenario">{{ scenario }}</li></ul>
                <p class="help-center__integration">{{ item.integration }}</p>
              </div>
              <a class="help-center__framework-link" :href="item.url" target="_blank" rel="noopener noreferrer" :aria-label="`${item.name} 官方文档（新窗口打开）`">官方文档 ↗</a>
            </article>
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
.help-center__version-card { display: flex; flex-direction: column; min-width: 0; padding: 20px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius); background: var(--ui-surface); }
.help-center__version-label { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; color: var(--ui-text-secondary); font-size: 14px; }
.help-center__version-label .el-icon { padding: 8px; box-sizing: content-box; border-radius: var(--ui-radius-control); background: var(--el-color-primary-light-9); color: var(--ui-primary); font-size: 18px; }
.help-center__version-card strong { display: block; color: var(--ui-text); font-size: 28px; font-weight: 600; line-height: 1.3; overflow-wrap: anywhere; }
.help-center__version-card p { margin: 10px 0 0; color: var(--ui-text-secondary); font-size: 12px; line-height: 1.6; }
.help-center__version-card .help-center__version-status { min-height: 38px; color: var(--ui-text-muted); overflow-wrap: anywhere; }
.help-center__framework-details { flex: 1; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--ui-border); }
.help-center__framework-details h3 { margin: 0; color: var(--ui-text); font-size: 13px; font-weight: 600; }
.help-center__framework-details h3:not(:first-child) { margin-top: 18px; }
.help-center__framework-details ul { margin: 8px 0 0; padding-left: 18px; color: var(--ui-text-secondary); font-size: 12px; line-height: 1.8; }
.help-center__version-card .help-center__integration { margin-top: 16px; padding: 10px 12px; border-radius: var(--ui-radius-control); background: var(--ui-bg-soft); }
.help-center__framework-link { align-self: flex-start; margin-top: 16px; color: var(--ui-primary); font-size: 12px; text-decoration: none; }
.help-center__framework-link:hover { text-decoration: underline; }
.help-center__framework-link:focus-visible { outline: 2px solid var(--ui-primary); outline-offset: 3px; border-radius: 2px; }
.help-center__operations { padding: 18px 6px 18px 2px; }
.help-center__operation-types { margin-bottom: 16px; }
.help-center__operation-menu { border-top: 1px solid var(--ui-border); }
.help-center__operation-title { color: var(--ui-text); font-size: 14px; font-weight: 600; }
.help-center__operation-menu :deep(.el-collapse-item__header) { min-height: 48px; padding: 0 14px; border-right: 1px solid var(--ui-border); border-left: 1px solid var(--ui-border); }
.help-center__operation-menu :deep(.el-collapse-item__wrap) { border-right: 1px solid var(--ui-border); border-left: 1px solid var(--ui-border); }
.help-center__operation-menu :deep(.el-collapse-item__content) { padding: 4px 18px 18px; }
@media (max-width: 760px) {
  .help-center__versions { grid-template-columns: 1fr; }
}
</style>
