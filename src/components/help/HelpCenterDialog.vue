<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import { InfoFilled, QuestionFilled, Tools } from '@element-plus/icons-vue';
import changelog from '../../../CHANGELOG.md?raw';
import faq from '../../../FAQ.md?raw';
import aiRecognitionGuide from '../../../AI识别操作说明.md?raw';
import appiumGuide from '../../../流程节点操作说明.md?raw';
import operationGuide from '../../../USAGE.md?raw';
import packageText from '../../../package.json?raw';
import MarkdownDocument from './MarkdownDocument.vue';

type PackageInfo = { version?: string; dependencies?: Record<string, string> };
type OperationSection = { id: string; title: string; content: string };

const visible = defineModel<boolean>({ required: true });
const activeTab = shallowRef('about');
type OperationType = 'midscene' | 'appium' | 'aiRecognition' | 'faq';

const operationType = shallowRef<OperationType>('midscene');
const activeOperation = shallowRef('');
const packageInfo = JSON.parse(packageText) as PackageInfo;
const dependencyVersion = (name: string) => packageInfo.dependencies?.[name]?.match(/(\d+\.\d+\.\d+)/)?.[1] ?? '未知';
const appVersion = packageInfo.version ?? '未知';
const midsceneVersion = dependencyVersion('@midscene/core');

const technologies = computed(() => [
  { name: 'Vue', version: dependencyVersion('vue'), description: '界面与交互框架' },
  { name: 'Element Plus', version: dependencyVersion('element-plus'), description: '界面组件库' },
  { name: 'Appium', version: '2.x', description: 'Android 原生自动化与回放' },
  { name: 'Midscene', version: midsceneVersion, description: 'AI 驱动的界面理解与自动化' },
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
  <el-dialog
    v-model="visible"
    title="帮助与版本"
    width="min(960px, calc(100vw - 48px))"
    class="help-center-dialog"
    top="5vh"
    draggable
    destroy-on-close
  >
    <el-tabs v-model="activeTab" class="help-center">
      <el-tab-pane name="about">
        <template #label><el-icon><InfoFilled /></el-icon><span>关于</span></template>
        <el-scrollbar height="min(620px, calc(100vh - 230px))">
          <div class="help-center__content">
            <div class="help-center__versions">
              <div><span>当前版本</span><strong>v{{ appVersion }}</strong></div>
              <div><span>Midscene 版本</span><strong>v{{ midsceneVersion }}</strong></div>
            </div>
            <h3 class="help-center__section-title">使用技术</h3>
            <div class="help-center__technology-grid">
              <div v-for="item in technologies" :key="item.name" class="help-center__technology">
                <div><strong>{{ item.name }}</strong><el-tag size="small" effect="plain">{{ item.version }}</el-tag></div>
                <p>{{ item.description }}</p>
              </div>
            </div>
          </div>
        </el-scrollbar>
      </el-tab-pane>
      <el-tab-pane name="guide">
        <template #label><el-icon><QuestionFilled /></el-icon><span>操作说明</span></template>
        <el-scrollbar height="min(620px, calc(100vh - 230px))">
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
        </el-scrollbar>
      </el-tab-pane>
      <el-tab-pane name="changelog">
        <template #label><el-icon><Tools /></el-icon><span>更新记录</span></template>
        <el-scrollbar height="min(620px, calc(100vh - 230px))">
          <div class="help-center__document"><MarkdownDocument :content="changelog" /></div>
        </el-scrollbar>
      </el-tab-pane>
    </el-tabs>
  </el-dialog>
</template>

<style scoped>
.help-center :deep(.el-tabs__header) { margin-bottom: 0; }
.help-center :deep(.el-tabs__item) { display: inline-flex; align-items: center; gap: 6px; }
.help-center__content,
.help-center__document { padding: 22px 6px 18px 2px; }
.help-center__versions { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.help-center__versions div { display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; border: 1px solid #e2e8f0; border-radius: 10px; background: #fff; }
.help-center__versions span { color: #64748b; }
.help-center__versions strong { color: #1677ff; font-size: 18px; }
.help-center__section-title { margin: 24px 0 12px; color: #1f2937; font-size: 17px; }
.help-center__technology-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.help-center__technology { padding: 14px 16px; border: 1px solid #e2e8f0; border-radius: 9px; background: #fff; }
.help-center__technology > div { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.help-center__technology p { margin: 6px 0 0; color: #64748b; font-size: 13px; }
.help-center__operations { padding: 18px 6px 18px 2px; }
.help-center__operation-types { margin-bottom: 16px; }
.help-center__operation-menu { border-top: 1px solid #e5e7eb; }
.help-center__operation-title { color: #334155; font-size: 14px; font-weight: 600; }
.help-center__operation-menu :deep(.el-collapse-item__header) { min-height: 48px; padding: 0 14px; border-right: 1px solid #e5e7eb; border-left: 1px solid #e5e7eb; }
.help-center__operation-menu :deep(.el-collapse-item__wrap) { border-right: 1px solid #e5e7eb; border-left: 1px solid #e5e7eb; }
.help-center__operation-menu :deep(.el-collapse-item__content) { padding: 4px 18px 18px; }
:global(.help-center-dialog.el-dialog) { margin-top: 5vh; }
@media (max-width: 760px) {
  .help-center__versions,
  .help-center__technology-grid { grid-template-columns: 1fr; }
}
</style>
