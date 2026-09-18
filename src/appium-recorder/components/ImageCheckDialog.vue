<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Aim, Camera, Upload, QuestionFilled } from '@element-plus/icons-vue';
import { IMAGE_CHECK_MODES, validateImageCheck, imageTemplateSize, imageTemplateRegionIssue, expandedImageTemplateRegion, type ImageCheckConfig } from '../image-check';
import { captureImageCheckRegion } from '../api';
import BranchTimeoutSettings from './BranchTimeoutSettings.vue';
import type { AppiumRecordedStep } from '../types';

const props = defineProps<{ config: ImageCheckConfig; deviceId: string; hasElement: boolean; editing: boolean; picking: boolean; timeoutBranch?: AppiumRecordedStep['timeoutBranch'] }>();
const emit = defineEmits<{ update: [config: ImageCheckConfig]; timeoutBranch: [value: NonNullable<AppiumRecordedStep['timeoutBranch']>]; close: []; confirm: []; pick: []; useElement: [] }>();
const busy = ref(false);
const regionIssue = computed(() => imageTemplateRegionIssue(props.config));
const expandedRegion = computed(() => expandedImageTemplateRegion(props.config));
const fileInput = ref<HTMLInputElement>();
const uploadSlot = ref<'template' | 'negativeTemplate'>('template');
const slots = computed(() => props.config.mode === 'state'
  ? [{ key: 'template' as const, label: '选中模板' }, { key: 'negativeTemplate' as const, label: '未选中模板' }]
  : props.config.mode === 'template' ? [{ key: 'template' as const, label: '模板' }] : []);
const numericFields = computed(() => [
  ...(['template', 'state'].includes(props.config.mode) ? [{ key: 'threshold' as const, label: '匹配严格度 (%)', min: 1, max: 100, step: 1 }] : []),
  ...(props.config.mode === 'state' ? [{ key: 'minScoreGap' as const, label: '两种状态最小得分差', min: 0.001, max: 1, step: 0.01 }] : []),
  ...(['black', 'color', 'change'].includes(props.config.mode) ? [
    { key: 'tolerance' as const, label: props.config.mode === 'black' ? '暗色亮度阈值 (0–255)' : 'RGB 通道容差 (0–255)', min: 0, max: 255, step: 1 },
    { key: 'ratio' as const, label: props.config.mode === 'change' ? '变化像素比例 %' : '目标像素占比 %', min: 0.01, max: 100, step: 1 },
  ] : []),
  ...(props.config.mode !== 'state' ? [
    { key: 'durationMs' as const, label: '最长观察时长 ms', min: 0, max: 60000, step: 1000 },
    { key: 'intervalMs' as const, label: '采样间隔 ms', min: 200, max: 10000, step: 200 },
    ...(props.config.mode !== 'change' ? [{ key: 'consecutive' as const, label: '连续满足帧数', min: 1, max: 100, step: 1 }] : []),
  ] : []),
]);
function patch(value: Partial<ImageCheckConfig>) { emit('update', { ...props.config, ...value }); }
function confirm() {
  try { validateImageCheck(props.config); emit('confirm'); }
  catch (error) { ElMessage.warning((error as Error).message); }
}
async function capture(key: 'template' | 'negativeTemplate') {
  busy.value = true;
  const regionKey = JSON.stringify(props.config.region);
  const deviceId = props.deviceId;
  try {
    const result = await captureImageCheckRegion(props.deviceId, props.config.region, props.config.screenWidth, props.config.screenHeight);
    if (deviceId !== props.deviceId || regionKey !== JSON.stringify(props.config.region)) throw new Error('采集期间目标区域已变化，请重新采集');
    patch({ [key]: result.base64, screenWidth: result.screenWidth, screenHeight: result.screenHeight });
  } catch (error) { ElMessage.error((error as Error).message); }
  finally { busy.value = false; }
}
function chooseFile(key: 'template' | 'negativeTemplate') { uploadSlot.value = key; fileInput.value?.click(); }
async function upload(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    if (file.size > 3 * 1024 * 1024 || file.type !== 'image/png') throw new Error('请选择小于 3MB 的 PNG 模板');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (Array.from(bytes.slice(0, 8)).join(',') !== '137,80,78,71,13,10,26,10') throw new Error('模板不是有效 PNG');
    const reader = new FileReader();
    reader.onload = () => patch({ [uploadSlot.value]: String(reader.result).split(',')[1] });
    reader.readAsDataURL(file);
  } catch (error) { ElMessage.error((error as Error).message); }
}
</script>

<template>
  <el-dialog :model-value="true" :title="editing ? '修改图像判断' : '添加图像判断'" width="520px" top="5vh"
    class="image-check-dialog" append-to-body draggable :modal="false" modal-penetrable
    :close-on-click-modal="false" :close-on-press-escape="false" :show-close="!busy" @close="emit('close')">
    <el-form label-position="top" size="small" :disabled="busy">
      <el-form-item label="检测模式">
        <el-select :model-value="config.mode" @update:model-value="patch({ mode: $event, consecutive: $event === 'black' ? 3 : 1, ratio: $event === 'change' ? 2 : 95 })">
          <el-option v-for="(label, key) in IMAGE_CHECK_MODES" :key="key" :label="label" :value="key" />
        </el-select>
        <el-tooltip content="适合固定图标、图片勾选、黑屏、颜色和画面变化。不识别任意文字或业务语义，不能仅凭外观证明按钮可用或视频卡死。证据不足时报告无法判定。" :show-after="200">
          <el-icon class="image-check-help"><QuestionFilled /></el-icon>
        </el-tooltip>
      </el-form-item>
      <el-form-item label="检测目标">
        <el-radio-group :model-value="config.target" @update:model-value="$event === 'element' ? emit('useElement') : patch({ target: 'region' })">
          <el-radio-button value="element" :disabled="!hasElement && config.target !== 'element'">当前选中元素</el-radio-button>
          <el-radio-button value="region">框选区域</el-radio-button>
        </el-radio-group>
        <el-tooltip content="组件按实时定位结果截图，同名组件必须限定父级；框选区域只在采集时相同屏幕尺寸下执行，尺寸变化需重新框选。模板按原始尺寸匹配，不自动缩放。">
          <el-icon class="image-check-help"><QuestionFilled /></el-icon>
        </el-tooltip>
      </el-form-item>
      <el-form-item v-if="config.target === 'region'" label="设备预览区域">
        <el-button :icon="Aim" @click="emit('pick')">{{ picking ? '正在框选' : '框选 / 拖动区域' }}</el-button>
      </el-form-item>
      <div class="image-check-grid">
        <el-form-item v-for="(label, key) in { x: 'X', y: 'Y', width: '宽度', height: '高度' }" :key="key" :label="label">
          <el-input-number :model-value="config.region[key]" :disabled="config.target === 'element'" :min="key === 'x' || key === 'y' ? 0 : 1" :max="16000" :precision="0" controls-position="right"
            @update:model-value="$event !== undefined && patch({ region: { ...config.region, [key]: $event } })" />
        </el-form-item>
      </div>
      <div v-if="slots.length" class="image-check-grid">
        <div v-for="slot in slots" :key="slot.key" class="image-check-template">
          <span>{{ slot.label }}</span>
          <small v-if="imageTemplateSize(config[slot.key])" class="image-check-size">{{ imageTemplateSize(config[slot.key])!.width }} × {{ imageTemplateSize(config[slot.key])!.height }} px</small>
          <el-image v-if="config[slot.key]" :src="'data:image/png;base64,' + config[slot.key]" :preview-src-list="['data:image/png;base64,' + config[slot.key]]" fit="contain" preview-teleported />
          <div v-else class="image-check-empty">未采集</div>
          <div>
            <el-tooltip content="截取当前检测区域作为模板，可再次采集替换"><el-button :icon="Camera" :disabled="!deviceId" :loading="busy" aria-label="采集模板" @click="capture(slot.key)" /></el-tooltip>
            <el-tooltip content="上传 PNG 替换模板"><el-button :icon="Upload" aria-label="上传模板" @click="chooseFile(slot.key)" /></el-tooltip>
          </div>
        </div>
      </div>
      <input ref="fileInput" type="file" accept="image/png" hidden @change="upload" />
      <el-alert v-if="regionIssue" :title="regionIssue" type="warning" show-icon :closable="false" class="image-check-region-warning">
        <el-button v-if="expandedRegion" size="small" @click="patch({ region: expandedRegion })">扩大检测区域</el-button>
      </el-alert>
      <el-form-item v-if="config.mode === 'template' || config.mode === 'change'" :label="config.mode === 'template' ? '预期匹配结果' : '判断条件'">
        <el-radio-group :model-value="config.expectation" @update:model-value="patch({ expectation: $event as 'present' | 'absent' })">
          <el-radio-button value="present">{{ config.mode === 'template' ? '匹配到模板' : '画面有变化' }}</el-radio-button>
          <el-radio-button value="absent">{{ config.mode === 'template' ? '未匹配到模板' : '持续无明显变化' }}</el-radio-button>
        </el-radio-group>
      </el-form-item>
      <el-form-item v-if="config.mode === 'color'" label="目标颜色 #RRGGBB">
        <el-color-picker :model-value="config.color" @update:model-value="$event && patch({ color: $event })" />
        <el-input :model-value="config.color" maxlength="7" @update:model-value="patch({ color: $event })" />
      </el-form-item>
      <div class="image-check-grid">
        <template v-for="field in numericFields" :key="field.key">
          <el-form-item :label="field.label">
            <template v-if="field.key === 'threshold'" #label>
              <span class="image-check-threshold-label">{{ field.label }}
                <el-tooltip effect="dark" placement="top" :show-after="200">
                  <template #content>
                    <div class="image-check-threshold-help">
                      当前画面与参考模板的匹配得分达到此值，才算匹配成功，得分不是正确概率。
                      数值越高越严格，可能漏掉有细微变化的目标；越低越宽松，可能误认相似图案。
                      例如设为 98%，需要匹配得分达到 98%。设为 100% 时，极细微的像素差异也会判为不匹配。图片状态判断还会结合两种模板的最小得分差，得分太接近时无法判定。
                    </div>
                  </template>
                  <el-button class="image-check-threshold-button" :icon="QuestionFilled" text aria-label="匹配严格度说明" @click.prevent />
                </el-tooltip>
              </span>
            </template>
            <el-input-number :model-value="field.key === 'threshold' ? Number((config.threshold * 100).toFixed(8)) : config[field.key]" :min="field.min" :max="field.max" :step="field.step" controls-position="right" @update:model-value="$event !== undefined && patch({ [field.key]: field.key === 'threshold' ? $event / 100 : $event })" />
            <el-alert v-if="field.key === 'threshold' && config.threshold === 1" title="100% 要求完全匹配，极细微的像素差异也会判为不匹配。" type="warning" :closable="false" show-icon class="image-check-strict-warning" />
          </el-form-item>
          <BranchTimeoutSettings v-if="field.key === 'durationMs'" style="grid-column: 1 / -1" :step="{ id: '', label: '', type: 'imageCheck', timeoutBranch }" :disabled="busy" @update="emit('timeoutBranch', $event)" />
        </template>
      </div>
      <BranchTimeoutSettings v-if="config.mode === 'state'" :step="{ id: '', label: '', type: 'imageCheck', timeoutBranch }" :disabled="busy" @update="emit('timeoutBranch', $event)" />
    </el-form>
    <template #footer><el-button :disabled="busy" @click="emit('close')">取消</el-button><el-button type="primary" :disabled="busy" @click="confirm">{{ editing ? '保存' : '添加' }}</el-button></template>
  </el-dialog>
</template>

<style>
.image-check-dialog { max-width: calc(100vw - 24px); }
.image-check-dialog .el-dialog__body { max-height: 70vh; overflow-y: auto; }
.image-check-dialog .el-select { flex: 1; }
.image-check-dialog .el-input-number { width: 100%; }
.image-check-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 12px; }
.image-check-help { margin-left: 8px; color: #606266; }
.image-check-grid .el-form-item__label { display: flex; align-items: center; min-height: 20px; }
.image-check-threshold-label { display: inline-flex; align-items: center; gap: 4px; }
.image-check-dialog .el-button.image-check-threshold-button { flex: 0 0 20px; width: 20px; height: 20px; min-height: 20px; padding: 0; font-size: 14px; }
.image-check-threshold-help { max-width: min(300px, calc(100vw - 40px)); font-size: 12px; line-height: 1.7; overflow-wrap: anywhere; }
.image-check-strict-warning { margin-top: 6px; }
.image-check-template { display: grid; gap: 6px; margin-bottom: 16px; min-width: 0; }
.image-check-size { color: #606266; font-size: 12px; }
.image-check-region-warning { margin-bottom: 16px; }
.image-check-template .el-image, .image-check-empty { height: 96px; width: 100%; background: #eff5f3; border: 1px solid #d5dfdb; border-radius: 4px; }
.image-check-empty { display: grid; place-items: center; color: #606266; }
@media (max-width: 480px) {
  .image-check-grid { grid-template-columns: minmax(0, 1fr); }
}
</style>
