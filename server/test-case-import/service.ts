import path from 'node:path';
import { formatTestCases } from './formatter';
import { parseExcel } from './parsers/excel';
import { parseTxt } from './parsers/txt';
import { parseWord } from './parsers/word';
import { parseTextCases } from './text-normalizer';
import type { ParsedTestCaseDocument, TestCaseImportResult, TestCaseSourceFormat } from './types';
import { validateTestCaseDocument } from './validator';

export const MAX_TEST_CASE_FILE_SIZE = 10 * 1024 * 1024;

const formatByExtension: Record<string, TestCaseSourceFormat> = {
  '.txt': 'txt',
  '.xls': 'excel',
  '.xlsx': 'excel',
  '.doc': 'word',
  '.docx': 'word',
};

// 文件扩展名决定解析器；所有解析结果随后统一校验并格式化为 Prompt。
export async function importTestCaseFile(input: { fileName: string; buffer: Buffer }): Promise<TestCaseImportResult> {
  const fileName = path.basename(input.fileName || '').trim();
  const extension = path.extname(fileName).toLowerCase();
  const format = formatByExtension[extension];

  if (!fileName || !format) {
    throw new Error('仅支持 txt、xls、xlsx、doc、docx 格式的测试用例文件');
  }
  if (!input.buffer.length) {
    throw new Error('上传文件为空');
  }
  if (input.buffer.length > MAX_TEST_CASE_FILE_SIZE) {
    throw new Error('文件大小不能超过 10MB');
  }

  let document: ParsedTestCaseDocument;
  if (format === 'excel') {
    const parsed = parseExcel(input.buffer);
    document = { format, ...parsed };
  } else {
    const rawText = format === 'txt' ? parseTxt(input.buffer) : await parseWord(input.buffer);
    document = {
      format,
      rawText,
      cases: parseTextCases(rawText, fileName),
    };
  }

  validateTestCaseDocument(document);
  const cases = document.cases.length ? document.cases : parseTextCases(document.rawText, fileName);

  return {
    fileName,
    format,
    caseCount: cases.length,
    prompt: formatTestCases(fileName, cases),
  };
}
