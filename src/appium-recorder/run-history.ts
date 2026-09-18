export type HistoryNode = {
  key: string;
  label: string;
  failed: boolean;
  durationMs: number | null;
};

export type RunSummary = {
  video?: { filePath: string; fileName: string; startedAt: string; warning?: string };
  id: string;
  scriptId: string;
  scriptName: string;
  appPackage: string;
  appVersion: string;
  deviceId: string;
  startedAt: string;
  durationMs: number;
  status: 'passed' | 'failed' | 'stopped';
  nodes: HistoryNode[];
};

export type RunDetail = RunSummary & {
  output: string;
  frames: { key: string; label: string; phase: string; capturedAt: string; imageUrl: string }[];
};

// 分母只计算实际到达该节点的运行；未执行的分支不能当作通过。
export function historyStatistics(runs: RunSummary[]) {
  const completed = runs.filter(run => run.status !== 'stopped');
  const nodes = new Map<string, { key: string; label: string; runs: number; failures: number; firstFailure: string; version: string }>();
  for (const run of [...completed].sort((a, b) => a.startedAt.localeCompare(b.startedAt))) {
    const unique = new Map<string, HistoryNode>();
    for (const node of run.nodes) {
      const prior = unique.get(node.key);
      unique.set(node.key, { ...node, failed: node.failed || Boolean(prior?.failed) });
    }
    for (const node of unique.values()) {
      const item = nodes.get(node.key) || { key: node.key, label: node.label, runs: 0, failures: 0, firstFailure: '', version: '' };
      item.runs++;
      if (node.failed) {
        item.failures++;
        if (!item.firstFailure) { item.firstFailure = run.startedAt; item.version = run.appVersion; }
      }
      nodes.set(node.key, item);
    }
  }
  return {
    passRate: completed.length ? completed.filter(run => run.status === 'passed').length / completed.length : null,
    failures: [...nodes.values()].filter(node => node.failures).sort((a, b) => b.failures - a.failures),
  };
}
