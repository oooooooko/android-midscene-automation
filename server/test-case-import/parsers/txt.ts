import { normalizeExtractedText } from '../text-normalizer';

// 优先按 UTF-8 解码；出现大量替换字符时兼容常见的 GB18030 中文文本。
export function parseTxt(buffer: Buffer) {
  let text = buffer.toString('utf8');
  const replacementCount = (text.match(/\uFFFD/g) || []).length;
  if (replacementCount > 2) {
    text = new TextDecoder('gb18030').decode(buffer);
  }
  return normalizeExtractedText(text);
}
