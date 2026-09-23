<script setup lang="ts">
import { computed, ref } from 'vue';
import { Delete, Plus } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { resolveAiPromptPresets, type AiPromptPreset } from '../../appium-recorder/ai-prompt-presets';
import { validateAiRecognitionPrompt } from '../../appium-recorder/ai-recognition';

const props = defineProps<{ modelValue?: AiPromptPreset[] }>();
const emit = defineEmits<{ 'update:modelValue': [presets: AiPromptPreset[]] }>();
const presets = computed(() => resolveAiPromptPresets(props.modelValue));
const draft = ref('');
const sceneName = ref('');

function addPreset() {
  try {
    const prompt = validateAiRecognitionPrompt(draft.value);
    const next = resolveAiPromptPresets([...presets.value, { name: sceneName.value, prompt }]);
    emit('update:modelValue', next);
    sceneName.value = '';
    draft.value = '';
  } catch (error) { ElMessage.warning(error instanceof Error ? error.message : '添加提示词失败'); }
}
</script>

<template>
  <section class="ai-prompt-settings" aria-labelledby="ai-prompt-presets-title">
    <h3 id="ai-prompt-presets-title">预设提示词</h3>
    <p class="ai-prompt-description">可在 AI 识别节点中选择并修改。删除预设不会修改已有节点的识别内容。</p>
    <div class="ai-prompt-layout">
      <el-form label-position="top" @submit.prevent="addPreset">
        <el-form-item label="测试场景">
          <el-input v-model="sceneName" maxlength="80" placeholder="例如：开屏广告检测" />
        </el-form-item>
        <el-form-item label="新增提示词">
          <el-input v-model="draft" type="textarea" :rows="4" maxlength="4000" show-word-limit placeholder="输入常用的识别内容，例如：当前画面是否出现广告弹窗？" />
        </el-form-item>
        <div class="ai-prompt-actions"><el-button native-type="submit" :icon="Plus">添加提示词</el-button></div>
      </el-form>
      <div class="ai-prompt-list" aria-label="已添加的提示词">
        <div v-for="(preset, index) in presets" :key="preset.name" class="ai-prompt-row">
          <div class="ai-prompt-content"><strong>{{ preset.name }}</strong><p>{{ preset.prompt }}</p></div>
          <el-button text :icon="Delete" :aria-label="`删除提示词 ${preset.name}`" @click="emit('update:modelValue', presets.filter((_, i) => i !== index))" />
        </div>
        <el-empty v-if="!presets.length" description="暂无预设提示词" :image-size="60" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.ai-prompt-settings { margin-top: 24px; padding-top: 24px; border-top: 1px solid var(--ui-border); }
.ai-prompt-settings h3 { margin: 0 0 8px; font-size: 15px; font-weight: 600; }
.ai-prompt-description { margin: 0 0 20px; color: var(--el-text-color-secondary); font-size: 12px; }
.ai-prompt-layout { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 32px; }
.ai-prompt-actions { display: flex; justify-content: flex-end; }
.ai-prompt-list { min-width: 0; max-height: 260px; overflow-y: auto; padding-left: 32px; border-left: 1px solid var(--ui-border); }
.ai-prompt-row { display: flex; align-items: flex-start; gap: 12px; padding: 10px 0; }
.ai-prompt-row + .ai-prompt-row { border-top: 1px solid var(--ui-border); }
.ai-prompt-content { flex: 1; min-width: 0; font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.6; }
.ai-prompt-content p { margin: 4px 0 0; color: var(--el-text-color-secondary); }
.ai-prompt-row .el-button { flex-shrink: 0; }
@media (max-width: 1000px) {
  .ai-prompt-layout { grid-template-columns: minmax(0, 1fr); gap: 24px; }
  .ai-prompt-list { padding: 16px 0 0; border-left: 0; border-top: 1px solid var(--ui-border); }
}
</style>
