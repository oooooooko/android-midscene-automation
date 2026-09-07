import assert from 'node:assert/strict';
import { buildFlowGraph } from '../src/appium-recorder/flow-graph';
import { labelFlowStep } from '../src/appium-recorder/flow-labels';
import type { AppiumRecordedStep } from '../src/appium-recorder/types';

const options: Parameters<typeof buildFlowGraph>[1] = {
  expandedStepIndex: null,
  selectedCopyIndexes: [],
  copyMode: false,
  canOpenInsertMenu: true,
  isStartActionDisabled: () => false,
  isInsertActionDisabled: () => false,
  isAppExecutionDisabled: () => false,
  startActionGroups: [],
  mainActionGroups: [],
  labelStep: labelFlowStep,
  isCopySelected: () => false,
};

function chain(prefix: string, length: number, parentConditionId?: string, parentBranch?: 'yes' | 'no'): AppiumRecordedStep[] {
  return Array.from({ length }, (_, index) => ({
    id: `${prefix}-${index}`,
    type: 'delay',
    label: `Delay ${index}`,
    timeoutMs: 5000,
    flow: { parentConditionId, parentBranch },
  }));
}

function checkLayout(steps: AppiumRecordedStep[], overrides: Partial<typeof options> = {}) {
  const original = JSON.stringify(steps);
  const graph = buildFlowGraph(steps, { ...options, ...overrides });
  assert.equal(JSON.stringify(steps), original, 'Layout must not modify script data');
  assert.equal(graph.nodes.filter((node) => node.data?.kind === 'step').length, steps.length);
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const center = (id: string) => {
    const node = nodes.get(id)!;
    return node.position.x + Number(node.width) / 2;
  };

  for (const edge of graph.edges) {
    const source = nodes.get(edge.source)!;
    const target = nodes.get(edge.target)!;
    assert.ok(target.position.y >= source.position.y + Number(source.height) + 23, `${edge.id}: vertical gap`);
    if (source.data?.kind === 'split') continue;
    assert.ok(Math.abs(center(source.id) - center(target.id)) <= 1, `${edge.id}: sequential nodes must stay aligned`);
  }

  for (const step of steps.filter((item) => item.flow?.nodeKind === 'condition')) {
    const yes = center(`branch:${step.id}:yes`);
    const no = center(`branch:${step.id}:no`);
    assert.ok(yes < no, `${step.id}: branch order`);
    assert.ok(Math.abs((yes + no) / 2 - center(`step:${step.id}`)) <= 1, `${step.id}: centered branches`);
  }

  for (const [index, a] of graph.nodes.entries()) {
    for (const b of graph.nodes.slice(index + 1)) {
      const overlapX = Math.min(a.position.x + Number(a.width), b.position.x + Number(b.width))
        - Math.max(a.position.x, b.position.x);
      const overlapY = Math.min(a.position.y + Number(a.height), b.position.y + Number(b.height))
        - Math.max(a.position.y, b.position.y);
      assert.ok(overlapX <= 1 || overlapY <= 1, `${a.id} overlaps ${b.id}`);
    }
  }
  return graph;
}

const longBranches: AppiumRecordedStep[] = [
  ...chain('main', 6),
  { id: 'outer', type: 'assertExists', label: 'Outer', flow: { nodeKind: 'condition' } },
  ...chain('yes', 9, 'outer', 'yes'),
  {
    id: 'inner', type: 'assertExists', label: 'Inner',
    flow: { nodeKind: 'condition', parentConditionId: 'outer', parentBranch: 'yes' },
  },
  ...chain('inner-yes', 65, 'inner', 'yes'),
  ...chain('inner-no', 42, 'inner', 'no'),
  ...chain('no', 57, 'outer', 'no'),
];

checkLayout(chain('linear', 100));
const initial = checkLayout(longBranches);
const resized = checkLayout(longBranches, {
  expandedStepIndex: 40,
  measuredNodeHeights: Object.fromEntries(longBranches.map((step, index) => [`step:${step.id}`, 95 + (index % 5) * 47])),
});
assert.deepEqual(
  resized.nodes.map((node) => node.position.x - resized.nodes[0].position.x),
  initial.nodes.map((node) => node.position.x - initial.nodes[0].position.x),
  'Height changes must not shift branch axes relative to the root',
);

const deepConditions: AppiumRecordedStep[] = Array.from({ length: 25 }, (_, index) => ({
  id: `deep-${index}`, type: 'assertExists', label: `Condition ${index}`,
  flow: {
    nodeKind: 'condition',
    parentConditionId: index ? `deep-${index - 1}` : undefined,
    parentBranch: index ? 'no' : undefined,
  },
}));
checkLayout([...deepConditions, ...chain('deep-tail', 50, 'deep-24', 'yes')]);

// Legacy return links must remain renderable even though they are not a DAG.
const cyclicSteps = chain('cycle', 3);
cyclicSteps[2].flow!.successTargetId = cyclicSteps[0].id;
assert.doesNotThrow(() => buildFlowGraph(cyclicSteps, options));

console.log('Appium flow layout checks passed (long chains, nested branches, resizing, legacy cycles)');
