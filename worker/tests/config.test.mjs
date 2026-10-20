import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mergeGeneratedOutbounds,
  parseSelectorRules,
  parseSelectorTags,
  parseTemplateVersion,
  serializeTemplateSettings,
} from '../src/lib/config.ts';

test('template version metadata preserves rules and legacy tags', () => {
  const legacy = JSON.stringify(['Global']);
  assert.equal(parseTemplateVersion(legacy), null);
  assert.deepEqual(parseSelectorTags(legacy), ['Global']);

  const stored = serializeTemplateSettings([], [{ outbound: '^HK$', nodes: '香港|HK' }], '1.14');
  assert.equal(parseTemplateVersion(stored), '1.14');
  assert.deepEqual(parseSelectorRules(stored), [{ outbound: '^HK$', nodes: '香港|HK' }]);
  assert.deepEqual(parseSelectorTags(stored), []);

  const legacyWithVersion = serializeTemplateSettings(['Global'], [], '1.12');
  assert.deepEqual(parseSelectorTags(legacyWithVersion), ['Global']);
});

test('selected empty groups receive matching nodes; configured groups stay unchanged', () => {
  const config = {
    outbounds: [
      { type: 'selector', tag: '手动选择', outbounds: ['direct'] },
      { type: 'selector', tag: '香港手动', outbounds: [] },
      { type: 'urltest', tag: '香港自动', outbounds: [] },
      { type: 'selector', tag: '日本手动', outbounds: [] },
      { type: 'selector', tag: '台湾手动', outbounds: [] },
    ],
  };
  const nodes = [{ type: 'vless', tag: 'HK 1' }, { type: 'hysteria2', tag: 'JP 1' }];
  const rules = parseSelectorRules(JSON.stringify({ rules: [
    { outbound: '^手动选择$', nodes: '.*' },
    { outbound: '^香港', nodes: 'HK|香港' },
    { outbound: '^日本手动$', nodes: '日本|JP' },
  ] }));

  mergeGeneratedOutbounds(config, nodes, [], rules);

  assert.deepEqual(config.outbounds[0].outbounds, ['direct']);
  assert.deepEqual(config.outbounds[1].outbounds, ['HK 1']);
  assert.deepEqual(config.outbounds[2].outbounds, ['HK 1']);
  assert.deepEqual(config.outbounds[3].outbounds, ['JP 1']);
  assert.deepEqual(config.outbounds[4].outbounds, ['COMPATIBLE']);
  assert.deepEqual(config.outbounds.slice(5), [...nodes, { tag: 'COMPATIBLE', type: 'direct' }]);
});

test('empty selected group receives a direct fallback', () => {
  const config = { outbounds: [{ type: 'selector', tag: '香港', outbounds: [] }] };
  mergeGeneratedOutbounds(config, [{ type: 'vless', tag: 'JP 1' }], [], [
    { outbound: '^香港$', nodes: '香港|HK' },
  ]);
  assert.deepEqual(config.outbounds[0].outbounds, ['COMPATIBLE']);
  assert.equal(JSON.stringify(config.outbounds.at(-1)), '{"tag":"COMPATIBLE","type":"direct"}');
});

test('legacy selected groups still receive all generated nodes', () => {
  const config = { outbounds: [{ type: 'selector', tag: 'Global', outbounds: [] }] };
  mergeGeneratedOutbounds(config, [{ type: 'vless', tag: 'HK 1' }], ['Global']);
  assert.deepEqual(config.outbounds[0].outbounds, ['HK 1']);
});

test('legacy selection does not alter an already configured group', () => {
  const config = { outbounds: [{ type: 'selector', tag: 'Global', outbounds: ['direct'] }] };
  mergeGeneratedOutbounds(config, [{ type: 'vless', tag: 'HK 1' }], ['Global']);
  assert.deepEqual(config.outbounds[0].outbounds, ['direct']);
});

test('unselected empty groups get one shared direct fallback without nodes', () => {
  const config = { outbounds: [
    { type: 'selector', tag: 'Manual', outbounds: [] },
    { type: 'urltest', tag: 'Auto' },
    { type: 'selector', tag: 'Configured', outbounds: ['direct'] },
  ] };
  mergeGeneratedOutbounds(config, [], []);
  assert.deepEqual(config.outbounds[0].outbounds, ['COMPATIBLE']);
  assert.deepEqual(config.outbounds[1].outbounds, ['COMPATIBLE']);
  assert.deepEqual(config.outbounds[2].outbounds, ['direct']);
  assert.deepEqual(config.outbounds.slice(3), [{ tag: 'COMPATIBLE', type: 'direct' }]);
});

test('fallback always resolves to a direct outbound when a tag already exists', () => {
  const config = { outbounds: [
    { type: 'selector', tag: 'Manual', outbounds: [] },
    { type: 'selector', tag: 'COMPATIBLE', outbounds: ['direct'] },
  ] };
  mergeGeneratedOutbounds(config, [], []);
  assert.deepEqual(config.outbounds[0].outbounds, ['COMPATIBLE']);
  assert.equal(JSON.stringify(config.outbounds[1]), '{"tag":"COMPATIBLE","type":"direct"}');
});
