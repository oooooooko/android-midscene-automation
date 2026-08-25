import WordExtractor from 'word-extractor';
import { normalizeExtractedText } from '../text-normalizer';

// word-extractor 同时支持 OLE .doc 与 OOXML .docx，并直接从 Buffer 提取正文。
export async function parseWord(buffer: Buffer) {
  const extractor = new WordExtractor();
  const document = await extractor.extract(buffer);
  return normalizeExtractedText(document.getBody());
}
