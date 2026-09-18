// 仅业务等待到期使用此错误；设备、通信和配置异常不能按超时分支放行。
export class ConditionTimeoutError extends Error {}

export class AppiumServiceError extends Error {}
