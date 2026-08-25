export type TestCaseSourceFormat = 'txt' | 'excel' | 'word';

export type ImportedTestCase = {
  title: string;
  preconditions: string[];
  steps: string[];
  expectedResults: string[];
  testData: string[];
  description: string[];
  priority: string;
};

export type ParsedTestCaseDocument = {
  format: TestCaseSourceFormat;
  rawText: string;
  cases: ImportedTestCase[];
};

export type TestCaseImportResult = {
  fileName: string;
  format: TestCaseSourceFormat;
  caseCount: number;
  prompt: string;
};
