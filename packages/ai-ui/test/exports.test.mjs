import test from 'node:test';
import assert from 'node:assert/strict';
import * as ui from '../dist/index.js';

test('@streetjs/ai-ui exports', async (t) => {
  await t.test('exposes all AI components', () => {
    for (const name of ['Chat', 'StreamingMessage', 'RAGSearch', 'ToolExecutionViewer']) {
      assert.equal(typeof ui[name], 'function', `missing component ${name}`);
    }
  });

  await t.test('exposes theming', () => {
    assert.equal(typeof ui.StreetAIStyles, 'function');
    assert.equal(typeof ui.streetAiCss, 'string');
    assert.ok(ui.streetAiCss.includes('prefers-color-scheme: dark'), 'css supports dark mode');
  });

  await t.test('StreamingMessage renders role + cursor while streaming', () => {
    const streamingNode = ui.StreamingMessage({ content: 'hi', streaming: true });
    assert.equal(streamingNode.props['data-role'], 'assistant');
    assert.equal(streamingNode.props['aria-live'], 'polite');
    const idleNode = ui.StreamingMessage({ content: 'done', streaming: false, role: 'user' });
    assert.equal(idleNode.props['data-role'], 'user');
    assert.equal(idleNode.props['aria-live'], undefined);
  });

  await t.test('ToolExecutionViewer renders empty state with no calls', () => {
    const node = ui.ToolExecutionViewer({ calls: [] });
    // single child paragraph for the empty state
    assert.ok(node.props.children);
  });
});
