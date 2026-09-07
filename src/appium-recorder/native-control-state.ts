import type { AppiumRecordedStep } from './types';

export type NativeStateType = 'checkboxState' | 'radioButtonState' | 'checkedState';

export function isNativeStateCondition(step: Pick<AppiumRecordedStep, 'type'>): step is { type: NativeStateType } {
  return step.type === 'checkboxState' || step.type === 'radioButtonState' || step.type === 'checkedState';
}

export function nativeControlName(type: NativeStateType) {
  return type === 'checkedState' ? '勾选组件（Checkbox / RadioButton / Switch）' : type === 'checkboxState' ? 'Checkbox' : 'RadioButton';
}

export function nativeControlType(className: unknown): NativeStateType | undefined {
  if (typeof className !== 'string') return undefined;
  // 识别原生、AppCompat 和 Material 控件；仅有 checkable 的 View 不能证明控件类型。
  if (/(?:^|\.)(?:AppCompat|Material)?CheckBox$/.test(className)) return 'checkboxState';
  if (/(?:^|\.)(?:AppCompat|Material)?RadioButton$/.test(className)) return 'radioButtonState';
  if (/(?:^|\.)(?:Switch|SwitchCompat|SwitchMaterial|MaterialSwitch)$/.test(className)) return 'checkedState';
  return undefined;
}

export function matchesNativeControl(type: NativeStateType, className: unknown) {
  const detected = nativeControlType(className);
  // 新节点自动识别三类控件，旧节点仍保留原有的类型约束。
  return type === 'checkedState' ? detected !== undefined : detected === type;
}

// UIAutomator XML 使用字符串，Appium 属性响应也可能返回布尔值；缺失值不能视为 false。
export function parseNativeBoolean(value: unknown): boolean | undefined {
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  return undefined;
}
