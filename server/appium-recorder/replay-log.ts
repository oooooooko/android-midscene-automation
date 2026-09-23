const TIME_PREFIX = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}:\d{3} - /;

export function stripReplayLogTime(line: string) {
  return line.replace(TIME_PREFIX, '');
}

export function timestampReplayLog(message: string, now = new Date()) {
  const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map(value => String(value).padStart(2, '0')).join('-');
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()].map(value => String(value).padStart(2, '0')).join(':');
  const prefix = `${date} ${time}:${String(now.getMilliseconds()).padStart(3, '0')} - `;
  // Appium 原始日志保留原时间，多行操作信息逐行补齐时间。
  return message.split(/\r?\n/).map(line => !line || TIME_PREFIX.test(line) ? line : prefix + line).join('\n');
}
