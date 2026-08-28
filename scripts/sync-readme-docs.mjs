import { readFile, writeFile } from 'node:fs/promises';

const generatedStart = '<!-- generated-docs:start -->';
const generatedEnd = '<!-- generated-docs:end -->';
const readmeUrl = new URL('../README.md', import.meta.url);

const stripFirstHeading = (markdown) =>
  markdown.replace(/^#\s+[^\r\n]+\r?\n+/, '').trim();

const stripUsageFaqPointer = (markdown) =>
  markdown.replace(
    /\n## 常见问题\r?\n\r?\n常见问题已独立整理到 \[FAQ\.md\]\(\.\/FAQ\.md\)。\r?\n/g,
    '\n',
  );

const linkReadmeAnchors = (markdown) =>
  markdown.replace(/\[FAQ\.md\]\(\.\/FAQ\.md\)/g, '[常见问题](#常见问题)');

const [readme, usage, faq, changelog] = await Promise.all([
  readFile(readmeUrl, 'utf8'),
  readFile(new URL('../USAGE.md', import.meta.url), 'utf8'),
  readFile(new URL('../FAQ.md', import.meta.url), 'utf8'),
  readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8'),
]);

const generatedIndex = readme.indexOf(generatedStart);
const readmeBody = (
  generatedIndex >= 0 ? readme.slice(0, generatedIndex) : readme
).trimEnd();

const generatedDocs = [
  generatedStart,
  '',
  '# Appium 录制器使用说明',
  '',
  linkReadmeAnchors(stripUsageFaqPointer(stripFirstHeading(usage))),
  '',
  '# 常见问题',
  '',
  stripFirstHeading(faq),
  '',
  '# 项目更新记录',
  '',
  stripFirstHeading(changelog),
  '',
  generatedEnd,
].join('\n');

await writeFile(readmeUrl, `${readmeBody}\n\n${generatedDocs}\n`, 'utf8');
