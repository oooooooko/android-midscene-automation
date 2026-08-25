import type { ScriptStep } from './types';

export function createPromptPreset(): ScriptStep[] {
  return [
    {
      id: crypto.randomUUID(),
      type: 'comment',
      label: '进入目标 App',
      prompt: '确保进入目标 App，再处理启动阶段弹窗',
      enabled: true,
    },
    {
      id: crypto.randomUUID(),
      type: 'act',
      label: '进入目标 App',
      prompt:
        '先观察当前界面：如果已经在目标 App 内，保持当前状态；如果不在目标 App 内，使用包名打开目标 App 并等待首屏加载完成。不要查找桌面图标或从最近任务中选择 App。',
      enabled: true,
    },
    {
      id: crypto.randomUUID(),
      type: 'act',
      label: '循环处理启动弹窗',
      prompt:
        '检查当前页面：如果仍有启动阶段的声明与条款、协议、隐私政策、权限、广告、活动、更新或通知引导弹窗遮挡业务操作，点击同意、允许、关闭、跳过或稍后再说。如果没有遮挡弹窗，不要点击业务内容、表单字段、复选框或提交按钮。',
      repeat: 1,
      enabled: true,
    },
    {
      id: crypto.randomUUID(),
      type: 'waitFor',
      label: '等待起始页面稳定',
      prompt: '页面已经稳定显示为本次测试的起始页面，并且没有协议、权限、广告、更新、活动或通知引导弹窗遮挡业务操作',
      enabled: true,
    },
  ];
}
