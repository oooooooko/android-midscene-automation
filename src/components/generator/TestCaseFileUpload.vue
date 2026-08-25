<script setup lang="ts">
import { Document, UploadFilled } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { useTemplateRef } from 'vue';

defineProps<{
  uploading: boolean;
  fileName: string;
}>();

const emit = defineEmits<{
  upload: [file: File];
}>();

const fileInput = useTemplateRef<HTMLInputElement>('fileInput');
const allowedExtensions = new Set(['txt', 'xls', 'xlsx', 'doc', 'docx']);
const maxFileSize = 10 * 1024 * 1024;

const openFilePicker = () => {
  if (!fileInput.value) return;
  fileInput.value.value = '';
  fileInput.value.click();
};

const handleFileChange = (event: Event) => {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;

  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  if (!allowedExtensions.has(extension)) {
    ElMessage.error('仅支持 txt、xls、xlsx、doc、docx 格式');
    return;
  }
  if (file.size > maxFileSize) {
    ElMessage.error('文件大小不能超过 10MB');
    return;
  }

  emit('upload', file);
};
</script>

<template>
  <div class="test-case-upload">
    <el-tooltip v-if="fileName" :content="fileName" placement="top">
      <span class="test-case-upload__file">
        <el-icon><Document /></el-icon>
        <span class="test-case-upload__name">{{ fileName }}</span>
      </span>
    </el-tooltip>
    <el-button
      size="small"
      :icon="UploadFilled"
      :loading="uploading"
      @click="openFilePicker"
    >
      上传用例
    </el-button>
    <input
      ref="fileInput"
      class="test-case-upload__input"
      type="file"
      accept=".txt,.xls,.xlsx,.doc,.docx"
      @change="handleFileChange"
    />
  </div>
</template>

<style scoped>
.test-case-upload {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.test-case-upload__file {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: 132px;
  color: #606266;
  font-size: 12px;
}

.test-case-upload__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.test-case-upload__input {
  display: none;
}
</style>
