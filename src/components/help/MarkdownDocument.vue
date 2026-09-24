<script setup lang="ts">
import { computed } from 'vue';

type DocumentBlock =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'code'; text: string }
  | { type: 'table'; headers: string[]; rows: string[][] };

const props = defineProps<{ content: string }>();

const cleanText = (value: string) => value
  .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
  .replace(/\*\*([^*]+)\*\*/g, '$1')
  .replace(/`([^`]+)`/g, '$1')
  .trim();

const splitTableRow = (line: string) => line
  .replace(/^\||\|$/g, '')
  .split('|')
  .map(cell => cleanText(cell));

const blocks = computed<DocumentBlock[]>(() => {
  const lines = props.content.replace(/\r\n/g, '\n').split('\n');
  const result: DocumentBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    if (/^([-*_])\1{2,}$/.test(trimmed)) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith('```')) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]!.trim().startsWith('```')) {
        code.push(lines[index]!);
        index += 1;
      }
      result.push({ type: 'code', text: code.join('\n') });
      index += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (heading) {
      result.push({ type: 'heading', level: heading[1]!.length, text: cleanText(heading[2]!) });
      index += 1;
      continue;
    }

    if (trimmed.includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1] ?? '')) {
      const headers = splitTableRow(trimmed);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index]!.includes('|') && lines[index]!.trim()) {
        rows.push(splitTableRow(lines[index]!));
        index += 1;
      }
      result.push({ type: 'table', headers, rows });
      continue;
    }

    const listMatch = /^(?:[-*]\s+|(\d+)\.\s+)(.+)$/.exec(trimmed);
    if (listMatch) {
      const ordered = Boolean(listMatch[1]);
      const items: string[] = [];
      while (index < lines.length) {
        const item = /^(?:[-*]\s+|(\d+)\.\s+)(.+)$/.exec(lines[index]!.trim());
        if (!item || Boolean(item[1]) !== ordered) break;
        items.push(cleanText(item[2]!));
        index += 1;
      }
      result.push({ type: 'list', ordered, items });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const next = lines[index]!.trim();
      if (!next || /^(#{1,6})\s+/.test(next) || next.startsWith('```') || /^(?:[-*]\s+|\d+\.\s+)/.test(next)) break;
      if (next.includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[index + 1] ?? '')) break;
      paragraph.push(cleanText(next));
      index += 1;
    }
    result.push({ type: 'paragraph', text: paragraph.join(' ') });
  }

  return result;
});
</script>

<template>
  <article class="markdown-document">
    <template v-for="(block, index) in blocks" :key="`${block.type}-${index}`">
      <h1 v-if="block.type === 'heading' && block.level === 1" class="markdown-document__h1">{{ block.text }}</h1>
      <h2 v-else-if="block.type === 'heading' && block.level === 2" class="markdown-document__h2">{{ block.text }}</h2>
      <h3 v-else-if="block.type === 'heading'" class="markdown-document__h3">{{ block.text }}</h3>
      <p v-else-if="block.type === 'paragraph'" class="markdown-document__paragraph">{{ block.text }}</p>
      <ol v-else-if="block.type === 'list' && block.ordered" class="markdown-document__list">
        <li v-for="item in block.items" :key="item">{{ item }}</li>
      </ol>
      <ul v-else-if="block.type === 'list'" class="markdown-document__list">
        <li v-for="item in block.items" :key="item">{{ item }}</li>
      </ul>
      <pre v-else-if="block.type === 'code'" class="markdown-document__code"><code>{{ block.text }}</code></pre>
      <div v-else-if="block.type === 'table'" class="markdown-document__table-wrap">
        <table class="markdown-document__table">
          <thead><tr><th v-for="header in block.headers" :key="header">{{ header }}</th></tr></thead>
          <tbody><tr v-for="(row, rowIndex) in block.rows" :key="rowIndex"><td v-for="(cell, cellIndex) in row" :key="cellIndex">{{ cell }}</td></tr></tbody>
        </table>
      </div>
    </template>
  </article>
</template>

<style scoped>
.markdown-document { color: #475569; font-size: 14px; line-height: 1.75; }
.markdown-document__h1 { margin: 0 0 18px; color: #1f2937; font-size: 24px; }
.markdown-document__h2 { margin: 24px 0 10px; color: #1f2937; font-size: 19px; }
.markdown-document__h3 { margin: 18px 0 8px; color: #334155; font-size: 16px; }
.markdown-document__paragraph { margin: 8px 0; }
.markdown-document__list { display: grid; gap: 5px; margin: 8px 0; padding-left: 24px; }
.markdown-document__code { margin: 12px 0; padding: 14px; overflow: auto; border-radius: 8px; background: #f3f6fa; color: #334155; white-space: pre-wrap; }
.markdown-document__table-wrap { margin: 12px 0; overflow-x: auto; }
.markdown-document__table { width: 100%; border-collapse: collapse; }
.markdown-document__table th,
.markdown-document__table td { padding: 9px 12px; border: 1px solid #e2e8f0; text-align: left; vertical-align: top; }
.markdown-document__table th { background: #f8fafc; color: #334155; }
</style>
