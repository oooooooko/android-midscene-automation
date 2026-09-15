<script setup lang="ts">
import { nextTick, shallowRef } from 'vue';
import type { MenuInstance, PopoverInstance } from 'element-plus';
import { PASTE_COMMAND, type FlowActionGroup, type InsertAction } from '../flow-graph';
import { actionDescriptions } from '../action-descriptions';

const props = defineProps<{
  groups: FlowActionGroup[];
  disabled?: boolean;
  clipboardCount?: number;
  isActionDisabled: (action: InsertAction) => boolean;
}>();

const emit = defineEmits<{
  command: [action: InsertAction | typeof PASTE_COMMAND];
}>();

const popoverRef = shallowRef<PopoverInstance>();
const triggerRef = shallowRef<HTMLElement>();
const menuRef = shallowRef<HTMLElement>();
const menuControlRef = shallowRef<MenuInstance>();
const menuMounted = shallowRef(false);

async function openMenu() {
  // 每次打开重新创建面板，避免上次选中的操作被当成当前值而无法重复添加。
  menuMounted.value = true;
  await nextTick();
  menuRef.value?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
}

function openGroupOnClick(event: MouseEvent, title: string) {
  if ((event.target as HTMLElement).closest('.el-sub-menu__title')) {
    menuControlRef.value?.open(title);
  }
}

async function handleMenuKeydown(event: KeyboardEvent) {
  const target = (event.target as HTMLElement).closest<HTMLElement>('[role="menuitem"]');
  if (!target || !['Enter', ' ', 'ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  const group = target.dataset.group;
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    const siblings = Array.from(target.parentElement!.querySelectorAll<HTMLElement>(
      ':scope > [role="menuitem"]:not(.is-disabled)',
    ));
    const offset = event.key === 'ArrowUp' ? -1 : 1;
    siblings[(siblings.indexOf(target) + offset + siblings.length) % siblings.length]?.focus();
  } else if (event.key === 'ArrowLeft') {
    const parent = target.parentElement?.closest<HTMLElement>('[data-group]');
    if (parent?.dataset.group) {
      menuControlRef.value?.close(parent.dataset.group);
      parent.focus();
    }
  } else if (group) {
    menuControlRef.value?.open(group);
    await nextTick();
    target.querySelector<HTMLElement>('.el-menu-item:not(.is-disabled)')?.focus();
  } else if (event.key !== 'ArrowRight') {
    target.click();
  }
}

function closeMenu() {
  popoverRef.value?.hide();
  triggerRef.value?.querySelector('button')?.focus();
}

function selectAction(value: string) {
  if (props.disabled) return;
  const action = value as InsertAction | typeof PASTE_COMMAND;
  if (action === PASTE_COMMAND ? !props.clipboardCount : props.isActionDisabled(action)) return;
  closeMenu();
  emit('command', action);
}
</script>

<template>
  <span ref="triggerRef" class="appium-action-menu-trigger">
    <el-popover
      ref="popoverRef"
      trigger="click"
      placement="bottom-start"
      width="auto"
      :disabled="disabled"
      :show-arrow="false"
      :hide-after="0"
      popper-class="appium-action-dropdown appium-action-menu"
      @before-enter="openMenu"
      @after-leave="menuMounted = false"
    >
      <template #reference><slot /></template>
      <div
        ref="menuRef"
        @keydown.capture="handleMenuKeydown"
        @keydown.esc.stop.prevent="closeMenu"
        @keydown.tab="closeMenu"
      >
        <el-menu
          v-if="menuMounted"
          ref="menuControlRef"
          collapse
          unique-opened
          :collapse-transition="false"
          :show-timeout="100"
          :hide-timeout="250"
          :popper-offset="4"
          @select="selectAction"
        >
          <el-sub-menu
            v-for="group in groups"
            :key="group.title"
            :index="group.title"
            :data-group="group.title"
            :aria-label="group.title"
            tabindex="-1"
            :teleported="false"
            popper-class="appium-action-submenu"
            @click="openGroupOnClick($event, group.title)"
          >
            <template #title>{{ group.title }}</template>
            <el-tooltip
              v-for="action in group.actions"
              :key="action.type"
              :content="actionDescriptions[action.type]"
              placement="right"
              effect="dark"
              :show-after="350"
              :hide-after="0"
              :enterable="false"
              :popper-options="{ modifiers: [{ name: 'preventOverflow', options: { altAxis: true, padding: 8 } }] }"
              popper-class="appium-action-description"
            >
              <el-menu-item
                :index="action.type"
                :disabled="isActionDisabled(action.type)"
              >
                {{ action.label }}
              </el-menu-item>
            </el-tooltip>
          </el-sub-menu>
          <el-menu-item v-if="clipboardCount" :index="PASTE_COMMAND" class="appium-action-paste">
            粘贴 {{ clipboardCount }} 个节点
          </el-menu-item>
        </el-menu>
      </div>
    </el-popover>
  </span>
</template>

<style>
.appium-action-description.el-popper {
  max-width: min(300px, calc(100vw - 32px));
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.6;
  overflow-wrap: anywhere;
  pointer-events: none;
}

.appium-action-menu-trigger {
  display: inline-flex;
}

.appium-action-menu.el-popover {
  min-width: 0;
  max-width: calc(100vw - 24px);
  padding: 0;
  overflow: visible;
}

.appium-action-menu .el-menu {
  --el-menu-item-height: 34px;
  --el-menu-sub-item-height: 34px;
  --el-menu-base-level-padding: 14px;
  --el-menu-text-color: var(--el-text-color-regular);
  --el-menu-hover-bg-color: var(--el-color-primary-light-9);
}

.appium-action-menu .el-menu--collapse {
  width: 132px;
  padding: 6px 0;
  border: 0;
  border-radius: 6px;
}

.appium-action-menu .appium-action-paste {
  font-size: 12px;
  font-weight: 700;
}

.appium-action-menu .el-menu--collapse > .el-sub-menu > .el-sub-menu__title .el-sub-menu__icon-arrow {
  display: inline-flex;
  position: static;
  width: 14px;
  height: 14px;
  margin: 0 0 0 auto;
  font-size: 14px;
  transform: none !important;
}

.appium-action-menu .el-sub-menu:focus-visible > .el-sub-menu__title,
.appium-action-menu .el-sub-menu.is-opened > .el-sub-menu__title,
.appium-action-menu .el-menu-item:focus-visible,
.appium-action-menu .el-menu-item:not(.is-disabled):hover {
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.appium-action-submenu .el-menu--popup {
  width: 226px;
  min-width: 0;
  max-width: calc(100vw - 24px);
  max-height: min(360px, calc(100dvh - 48px));
  overflow-y: auto;
  overscroll-behavior: contain;
}

.appium-action-submenu .el-menu-item {
  height: auto;
  min-height: 34px;
  padding: 7px 14px;
  line-height: 20px;
  white-space: normal;
  overflow-wrap: anywhere;
}
</style>
