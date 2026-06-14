import test from 'node:test';
import assert from 'node:assert/strict';
import * as ui from '../dist/index.js';

test('@streetjs/admin-ui exports', async (t) => {
  await t.test('exposes all admin components', () => {
    for (const name of ['UserManagement', 'RoleManager', 'AuditLogViewer', 'TenantSwitcher']) {
      assert.equal(typeof ui[name], 'function', `missing component ${name}`);
    }
  });

  await t.test('exposes theming + AsyncState', () => {
    assert.equal(typeof ui.StreetAdminStyles, 'function');
    assert.equal(typeof ui.AsyncState, 'function');
    assert.equal(typeof ui.streetAdminCss, 'string');
    assert.ok(ui.streetAdminCss.includes('prefers-color-scheme: dark'), 'css supports dark mode');
  });

  await t.test('AsyncState shows loading / error / empty branches', () => {
    const loadingNode = ui.AsyncState({ loading: true, empty: false, children: 'x' });
    assert.equal(loadingNode.props.role, 'status');
    const errNode = ui.AsyncState({ loading: false, error: new Error('nope'), empty: false, children: 'x' });
    assert.equal(errNode.props.role, 'alert');
    const emptyNode = ui.AsyncState({ loading: false, empty: true, emptyText: 'none', children: 'x' });
    assert.equal(emptyNode.props.children, 'none');
    const okNode = ui.AsyncState({ loading: false, empty: false, children: 'content' });
    assert.equal(okNode, 'content');
  });
});
