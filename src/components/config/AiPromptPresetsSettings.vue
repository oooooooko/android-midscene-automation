<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue';
import { Check, Close, Delete, Edit, Plus } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { resolveAiPromptPresets, type AiPromptPreset } from '../../appium-recorder/ai-prompt-presets';
import { validateAiRecognitionPrompt } from '../../appium-recorder/ai-recognition';

const props = defineProps<{ modelValue?: AiPromptPreset[] }>();
const emit = defineEmits<{ 'update:modelValue': [presets: AiPromptPreset[]] }>();
const presets = computed(() => resolveAiPromptPresets(props.modelValue));
const draft = ref('');
const sceneName = ref('');
const editIndex = shallowRef<number | null>(null);
const editSceneName = ref('');
const editPrompt = ref('');

function addPreset() {
  try {
    const prompt = validateAiRecognitionPrompt(draft.value);
    const next = resolveAiPromptPresets([...presets.value, { name: sceneName.value, prompt }]);
    emit('update:modelValue', next);
    sceneName.value = '';
    draft.value = '';
  } catch (error) { ElMessage.warning(error instanceof Error ? error.message : '添加提示词失败'); }
}

function startEdit(index: number) {
  const preset = presets.value[index];
  if (!preset) return;
  editIndex.value = index;
  editSceneName.value = preset.name;
  editPrompt.value = preset.prompt;
}

function cancelEdit() {
  editIndex.value = null;
  editSceneName.value = '';
  editPrompt.value = '';
}

function saveEdit() {
  if (editIndex.value === null) return;
  try {
    const next = presets.value.map((preset, index) => index === editIndex.value
      ? { name: editSceneName.value, prompt: validateAiRecognitionPrompt(editPrompt.value) }
      : preset);
    emit('update:modelValue', resolveAiPromptPresets(next));
    cancelEdit();
    ElMessage.success('预设提示词已修改');
  } catch (error) {
    ElMessage.warning(error instanceof Error ? error.message : '修改提示词失败');
  }
}
</script>

<template>
  <section class="ai-prompt-settings" aria-labelledby="ai-prompt-presets-title">
    <h3 id="ai-prompt-presets-title" class="ai-prompt-visually-hidden">AI 识别预设提示词</h3>
    <p class="ai-prompt-description">添加常用测试场景，录制 AI 识别节点时可以直接选择。删除预设不会修改已有节点。</p>
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
        <div v-for="(preset, index) in presets" :key="`${preset.name}-${index}`" class="ai-prompt-row" :class="{ 'ai-prompt-row--editing': editIndex === index }">
          <template v-if="editIndex === index">
            <div class="ai-prompt-editor">
              <el-input v-model="editSceneName" maxlength="80" placeholder="测试场景名称" />
              <el-input v-model="editPrompt" type="textarea" :rows="3" maxlength="4000" show-word-limit placeholder="提示词内容" />
              <div class="ai-prompt-editor__actions">
                <el-button size="small" :icon="Close" @click="cancelEdit">取消</el-button>
                <el-button size="small" type="primary" :icon="Check" @click="saveEdit">保存</el-button>
              </div>
            </div>
          </template>
          <template v-else>
            <div class="ai-prompt-content"><strong>{{ preset.name }}</strong><p>{{ preset.prompt }}</p></div>
            <div class="ai-prompt-row__actions">
              <el-button text :icon="Edit" :disabled="editIndex !== null" :aria-label="`编辑提示词 ${preset.name}`" @click="startEdit(index)" />
              <el-button text :icon="Delete" :disabled="editIndex !== null" :aria-label="`删除提示词 ${preset.name}`" @click="emit('update:modelValue', presets.filter((_, i) => i !== index))" />
            </div>
          </template>
        </div>
        <el-empty v-if="!presets.length" description="暂无预设提示词" :image-size="60" />
      </div>
    </div>
  </section>
</template>

<style scoped>
.ai-prompt-visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.ai-prompt-description { margin: 0 0 20px; color: var(--el-text-color-secondary); font-size: 12px; }
.ai-prompt-layout { display: grid; gap: 20px; }
.ai-prompt-actions { display: flex; justify-content: flex-end; }
.ai-prompt-list { --ai-prompt-row-height: 76px; min-width: 0; height: calc(var(--ai-prompt-row-height) * 3 + 1px); overflow-y: auto; scrollbar-gutter: stable; border-top: 1px solid var(--ui-border); }
.ai-prompt-row { display: flex; align-items: flex-start; gap: 12px; height: var(--ai-prompt-row-height); box-sizing: border-box; padding: 10px 0; }
.ai-prompt-row--editing { height: auto; min-height: var(--ai-prompt-row-height); }
.ai-prompt-row + .ai-prompt-row { border-top: 1px solid var(--ui-border); }
.ai-prompt-content { flex: 1; min-width: 0; font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.6; }
.ai-prompt-content strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-prompt-content p { display: -webkit-box; margin: 4px 0 0; overflow: hidden; color: var(--el-text-color-secondary); -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.ai-prompt-row__actions { display: flex; flex-shrink: 0; }
.ai-prompt-editor { display: grid; flex: 1; gap: 10px; min-width: 0; padding-right: 4px; }
.ai-prompt-editor__actions { display: flex; justify-content: flex-end; gap: 8px; }
.ai-prompt-row .el-button { flex-shrink: 0; }
.ai-prompt-list :deep(.el-empty) { height: 100%; padding: 0; }
</style>
