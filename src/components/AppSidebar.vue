<script setup lang="ts">
import { DataAnalysis, Grid, Monitor, Operation, InfoFilled, Setting } from '@element-plus/icons-vue';
import type { MenuKey } from '../types';

defineProps<{ activeMenu: MenuKey; collapsed: boolean }>();
defineEmits<{ select: [key: string] }>();
</script>

<template>
  <aside class="layout-sidebar" aria-label="主导航">
    <div class="layout-sidebar__top">
      <div class="layout-sidebar__logo" aria-hidden="true">M</div>
      <span v-if="!collapsed" class="layout-sidebar__brand">Midscene <span>Admin</span></span>
    </div>
    <el-menu :default-active="activeMenu" :default-openeds="['overview', 'midscene']" :collapse="collapsed"
      :collapse-transition="false" class="layout-menu" @select="$emit('select', $event)">
      <el-sub-menu index="overview" aria-label="概览">
        <template #title><el-icon><Grid /></el-icon><span>概览</span></template>
        <el-menu-item index="analysis" aria-label="分析页"><el-icon><DataAnalysis /></el-icon><template #title>分析页</template></el-menu-item>
      </el-sub-menu>
      <el-sub-menu index="midscene" aria-label="Midscene">
        <template #title><el-icon><Operation /></el-icon><span>Midscene</span></template>
        <el-menu-item index="generator" aria-label="测试脚本生成"><el-icon><Operation /></el-icon><template #title>测试脚本生成</template></el-menu-item>
        <el-menu-item index="automation" aria-label="自动化测试"><el-icon><Monitor /></el-icon><template #title>自动化测试</template></el-menu-item>
      </el-sub-menu>
      <el-menu-item index="appium" aria-label="Appium"><el-icon><Monitor /></el-icon><template #title>Appium</template></el-menu-item>
      <el-menu-item index="config" aria-label="参数配置"><el-icon><Setting /></el-icon><template #title>参数配置</template></el-menu-item>
      <el-menu-item index="about" aria-label="关于"><el-icon><InfoFilled /></el-icon><template #title>关于</template></el-menu-item>
    </el-menu>
  </aside>
</template>
