import type { StepType } from './types';

export const stepTypeOptions: Array<{ label: string; value: StepType }> = [
  { label: '注释', value: 'comment' },
  { label: 'aiAct', value: 'act' },
  { label: 'aiWaitFor', value: 'waitFor' },
  { label: 'aiTap', value: 'tap' },
  { label: 'aiInput', value: 'input' },
  { label: 'aiQuery', value: 'query' },
  { label: 'aiBoolean', value: 'boolean' },
  { label: 'aiString', value: 'string' },
  { label: 'aiNumber', value: 'number' },
];

export const stepTypeDescriptions: Record<StepType, { description: string; example: string }> = {
  comment: {
    description: '只写注释，不执行动作。适合说明意图、标记阶段或补充上下文。',
    example: '示例：处理登录前弹窗',
  },
  act: {
    description: '适合一段自然语言动作，比如连续点击、关闭弹窗、完成一组界面操作。',
    example: '示例：若出现权限弹窗则点击允许，若出现广告弹窗则关闭',
  },
  waitFor: {
    description: '等待某个界面条件成立后再继续，适合加载完成、页面稳定、元素出现。',
    example: '示例：登录页面已经稳定显示，并且可以开始输入账号密码',
  },
  tap: {
    description: '点击一个明确目标，适合按钮、列表项、返回键这类单步操作。',
    example: '示例：登录按钮',
  },
  input: {
    description: '向输入框填写内容。Prompt 写定位目标，输入值单独填在“输入值”。',
    example: '示例：Prompt=手机号输入框；输入值=13800138000',
  },
  query: {
    description: '提取结构化数据，适合列表、表格、对象数组，输出到变量供后续使用。',
    example: '示例：{ title: string, price: number }[], 当前页面商品列表',
  },
  boolean: {
    description: '判断真假，适合判断弹窗是否存在、状态是否满足、按钮是否可见。',
    example: '示例：当前页面上是否还存在会遮挡登录操作的弹窗',
  },
  string: {
    description: '提取单条文本，适合标题、用户名、标签内容。',
    example: '示例：当前页面最显眼的标题文本',
  },
  number: {
    description: '提取数字，适合计数、金额、数量、页码。',
    example: '示例：购物车角标上的商品数量',
  },
};
