<script setup lang="ts">
import { computed } from 'vue';
import { resolveAiDeduplication, type AiDeduplicationConfig } from '../../appium-recorder/ai-deduplication';

const props = defineProps<{ modelValue?: AiDeduplicationConfig; disabled?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: AiDeduplicationConfig] }>();
const settings = computed(() => props.modelValue ?? resolveAiDeduplication());
function patch(value: Partial<AiDeduplicationConfig>) {
  emit('update:modelValue', { ...settings.value, ...value });
}
</script>

<template>
  <section class="ai-dedup-settings" aria-label="持续观察截图去重">
    <h3 class="ai-dedup-title">持续观察截图去重</h3>
    <el-form-item label="去重方式">
      <el-radio-group :model-value="settings.method" :disabled="disabled" @update:model-value="patch({ method: $event as AiDeduplicationConfig['method'] })">
        <el-radio-button value="none">不去重</el-radio-button>
        <el-radio-button value="pixelmatch">pixelmatch（默认）</el-radio-button>
        <el-radio-button value="opencv">OpenCV（SSIM）</el-radio-button>
      </el-radio-group>
    </el-form-item>
    <template v-if="settings.method === 'pixelmatch'">
      <el-form-item label="像素颜色容差">
        <el-input-number :model-value="settings.pixelmatch.threshold" :disabled="disabled" :min="0" :max="1" :step="0.01" :precision="2" controls-position="right" @update:model-value="patch({ pixelmatch: { ...settings.pixelmatch, threshold: $event ?? 0.1 } })" />
        <p class="ai-dedup-help">默认 0.10。越大越容易忽略颜色细微差异；设为 0 时逐像素严格比较。</p>
      </el-form-item>
      <el-form-item label="允许变化面积（%）">
        <el-input-number :model-value="settings.pixelmatch.maxChangedRatio" :disabled="disabled" :min="0" :max="100" :step="0.1" :precision="2" controls-position="right" @update:model-value="patch({ pixelmatch: { ...settings.pixelmatch, maxChangedRatio: $event ?? 0.5 } })" />
        <p class="ai-dedup-help">默认 0.50%。变化像素占比不超过此值时去重。越大保留越少，但可能忽略小弹窗或文字变化。</p>
      </el-form-item>
    </template>
    <template v-else-if="settings.method === 'opencv'">
      <el-form-item label="SSIM 相似度阈值">
        <el-input-number :model-value="settings.opencv.similarityThreshold" :disabled="disabled" :min="0.5" :max="1" :step="0.005" :precision="3" controls-position="right" @update:model-value="patch({ opencv: { ...settings.opencv, similarityThreshold: $event ?? 0.99 } })" />
        <p class="ai-dedup-help">默认 0.990。相似度达到此值时去重；越接近 1 越严格、保留越多，调低可减少提交图片。</p>
      </el-form-item>
      <el-form-item label="比较图像最长边（px）">
        <el-input-number :model-value="settings.opencv.maxDimension" :disabled="disabled" :min="128" :max="1024" :step="128" :precision="0" controls-position="right" @update:model-value="patch({ opencv: { ...settings.opencv, maxDimension: $event ?? 512 } })" />
        <p class="ai-dedup-help">默认 512。仅缩小本地比较图像；越大越能保留细节，也更耗本地计算资源，不改变提交模型的图片尺寸。</p>
      </el-form-item>
    </template>
    <div class="ai-dedup-explanation">
      <p><strong>不去重：</strong>全部采样截图交给模型，保留信息最多，图片输入消耗也最高。</p>
      <p><strong>pixelmatch：</strong>比较原图的像素颜色和变化面积，适合同设备的静态画面，对细节变化敏感。</p>
      <p><strong>OpenCV（SSIM）：</strong>缩小图片后比较彩色画面的局部亮度、对比度和结构，更侧重整体相似性；可能忽略小文字，不能识别语义，也不自动对齐位移。</p>
      <p>仅对持续观察生效。首帧始终保留，后续与上一张保留的截图比较；两种去重均在本地完成，不调用模型。切换方式会保留各自参数，用于后续回放和识别测试。</p>
    </div>
  </section>
</template>

<style scoped>
.ai-dedup-settings { height: 540px; box-sizing: border-box; overflow-y: auto; scrollbar-gutter: stable; padding-right: 4px; }
.ai-dedup-title { margin: 0 0 20px; font-size: 15px; font-weight: 600; color: var(--el-text-color-primary); }
.ai-dedup-help { width: 100%; margin: 6px 0 0; color: var(--el-text-color-secondary); font-size: 12px; line-height: 1.6; }
.ai-dedup-explanation { color: var(--el-text-color-regular); font-size: 13px; line-height: 1.7; }
.ai-dedup-explanation p { margin: 6px 0; }
.ai-dedup-settings :deep(.el-radio-group) { gap: 4px 0; }
</style>
