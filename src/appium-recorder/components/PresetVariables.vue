<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { QuestionFilled } from '@element-plus/icons-vue';
import { loadVariables, saveVariables } from '../api';
import VariableTable from './VariableTable.vue';
import { validateVariables, type TestVariable } from '../variables';
const props = defineProps<{ variables: TestVariable[]; disabled?: boolean; scriptName: string; scriptId: string }>();
const emit = defineEmits<{ 'update:variables': [TestVariable[]]; saved: [string, TestVariable[]] }>();
const globals = ref<TestVariable[]>([]);
const busy = ref(false);
const loaded = ref(false);
const error = ref('');
const status = ref({ global: '', private: '' });
const invalid = ref({ global: false, private: false });
const revisions = { global: 0, private: 0 };
let mounted = true;
onBeforeUnmount(() => { mounted = false; });
const privateUrl = props.scriptId ? `/api/appium-recorder/variables?scriptId=${encodeURIComponent(props.scriptId)}` : '/api/appium-recorder/variables?draft=1';
async function load() {
  busy.value = true; error.value = '';
  try {
    globals.value = (await loadVariables('/api/appium-recorder/variables')).variables; loaded.value = true;
    if (props.scriptId || !props.variables.length) {
      const variables = (await loadVariables(privateUrl)).variables;
      if (mounted) emit('update:variables', variables);
    }
  } catch (cause) { error.value = String(cause); }
  finally { busy.value = false; }
}
function update(scope: 'global' | 'private', values: TestVariable[]) {
  if (scope === 'global') globals.value = values;
  else emit('update:variables', values);
  const revision = ++revisions[scope];
  let variables: TestVariable[];
  try {
    variables = validateVariables(values);
  } catch (cause) {
    status.value[scope] = cause instanceof Error ? cause.message : String(cause);
    invalid.value[scope] = true;
    return;
  }
  invalid.value[scope] = false;
  status.value[scope] = '正在保存…';
  // 同一作用域串行写入，慢响应不能覆盖后一次编辑；不锁定输入框。
  void (async () => {
    try {
      await saveVariables(scope === 'global' ? '/api/appium-recorder/variables' : privateUrl, variables);
      if (scope === 'private') emit('saved', props.scriptId, variables);
      if (revision === revisions[scope]) status.value[scope] = scope === 'private' && !props.scriptId ? '草稿已自动保存' : '已自动保存';
    } catch (cause) {
      if (revision === revisions[scope]) {
        status.value[scope] = cause instanceof Error ? cause.message : String(cause);
        invalid.value[scope] = true;
      }
    }
  })();
}
onMounted(load);
</script>

<template>
  <div class="preset-variables">
    <section class="preset-variables__section" aria-label="全局变量">
      <div class="preset-variables__title">
        <h3>全局变量</h3>
      <el-tooltip placement="bottom-end" effect="light" :show-after="150">
        <template #content>
          <div class="preset-variables__help">
            <strong>如何使用预设变量</strong>
            <p>全局变量可在所有脚本中使用；私有变量仅在当前脚本中使用，同名时优先使用私有变量。</p>
            <p>编辑后自动保存，变量值可以为空字符串。新脚本的私有变量先保存为草稿，首次保存脚本时归入该脚本。</p>
            <p>使用 <code v-pre>{{变量名}}</code> 在输入、判断、定位、日志中引用，例如 <code v-pre>{{account}}</code>。变量名使用字母、数字和下划线，不能以数字开头。</p>
            <p>敏感值在日志和报告中脱敏，导出时清空敏感值；密码、令牌等名称自动标记为敏感，也可手动勾选。</p>
            <p>含敏感变量的运行不保存截图或 Appium 原始日志。本地变量非加密存储。</p>
          </div>
        </template>
        <el-button class="preset-variables__help-button" :icon="QuestionFilled" text aria-label="预设变量使用说明" />
      </el-tooltip>
      </div>
        <el-alert v-if="error" :title="error" type="error" :closable="false" /><el-button v-if="error" @click="load">重新加载</el-button>
        <VariableTable :model-value="globals" :disabled="disabled || busy || !loaded" @update:model-value="update('global', $event)">
          <span class="preset-variables__status" :class="{ 'is-error': invalid.global }" role="status">{{ status.global }}</span>
        </VariableTable>
    </section>
    <section class="preset-variables__section" aria-label="当前脚本私有变量">
        <div class="preset-variables__title"><h3>当前脚本私有变量</h3></div>
        <div class="preset-variables__script">{{ scriptName || '未命名脚本' }}</div>
        <VariableTable :model-value="variables" :disabled="disabled || busy" @update:model-value="update('private', $event)">
          <span class="preset-variables__status" :class="{ 'is-error': invalid.private }" role="status">{{ status.private }}</span>
        </VariableTable>
    </section>
  </div>
</template>

<style scoped>
.preset-variables { padding: 12px 16px; overflow: auto; }
.preset-variables__help-button { width: 28px; height: 28px; padding: 0; font-size: 16px; }
.preset-variables__section { padding: 16px 0 22px; }
.preset-variables__section:first-child { padding-top: 0; }
.preset-variables__section + .preset-variables__section { border-top: 1px solid var(--el-border-color-lighter); }
.preset-variables__title { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.preset-variables__title h3 { margin: 0; font-size: 14px; font-weight: 600; }
.preset-variables__script { font-size: 12px; color: var(--el-text-color-secondary); margin: -5px 0 12px; overflow-wrap: anywhere; }
.preset-variables__help { width: min(340px, calc(100vw - 64px)); font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }
.preset-variables__help p { margin: 8px 0 0; }
.preset-variables__help code { color: var(--el-color-primary); }
.preset-variables__status { font-size: 12px; color: var(--el-text-color-secondary); overflow-wrap: anywhere; }
.preset-variables__status.is-error { color: var(--el-color-danger); }
</style>
