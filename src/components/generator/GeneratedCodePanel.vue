<script setup lang="ts">
import { CopyDocument, Edit, RefreshLeft } from '@element-plus/icons-vue';

defineProps<{
  code: string;
  showCode: boolean;
  editing: boolean;
  saving: boolean;
}>();

const draftCode = defineModel<string>('draftCode', { required: true });

defineEmits<{
  copy: [];
  edit: [];
  undo: [];
  save: [];
}>();
</script>

<template>
  <el-card shadow="never" class="generator-code-card">
    <template #header>
      <div class="panel-header">
        <span>生成代码</span>
        <div class="panel-header__actions">
          <el-button
            type="success"
            :icon="CopyDocument"
            :disabled="!showCode"
            @click="$emit('copy')"
          >
            复制
          </el-button>
          <el-button
            v-if="!editing"
            type="primary"
            :icon="Edit"
            :disabled="!showCode"
            @click="$emit('edit')"
          >
            编辑
          </el-button>
          <template v-else>
            <el-button :icon="RefreshLeft" :disabled="saving" @click="$emit('undo')">
              撤回修改
            </el-button>
            <el-button
              type="primary"
              :loading="saving"
              @click="$emit('save')"
            >
              保存
            </el-button>
          </template>
        </div>
      </div>
    </template>

    <el-input
      v-if="editing"
      v-model="draftCode"
      type="textarea"
      resize="none"
      spellcheck="false"
      class="generator-code-editor"
    />
    <pre v-else class="code-block generator-code-block"><code>{{ showCode ? code : '' }}</code></pre>
  </el-card>
</template>
