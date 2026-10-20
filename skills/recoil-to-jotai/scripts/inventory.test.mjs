/**
 * Runs the inventory against examples/recoil-app and checks every planted hard case is found.
 *   node --test scripts/inventory.test.mjs
 * Set RECOIL_TO_JOTAI_TS to a typescript package path if the fixture has no node_modules yet.
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'inventory.mjs');
const fixture = resolve(here, '../../../examples/recoil-app/src');
const outDir = mkdtempSync(join(tmpdir(), 'recoil-inventory-'));

execFileSync(process.execPath, [script, fixture, '--out', outDir, '--quiet'], { stdio: 'inherit' });
const inventory = JSON.parse(readFileSync(join(outDir, 'recoil-inventory.json'), 'utf8'));
const byName = Object.fromEntries(inventory.features.map((f) => [f.name, f]));
const names = (ids) => ids.map((id) => id.slice(id.lastIndexOf('#') + 1)).sort();
const roles = (name) => Object.fromEntries(byName[name].consumers.map((c) => [basename(c.file), c.roles]));

test('finds every planted feature with its kind', () => {
  assert.deepEqual(Object.fromEntries(Object.values(byName).map((f) => [f.name, f.kind])), {
    counterAtom: 'atom',
    userAtom: 'atom',
    themeAtom: 'atom',
    todoIdsAtom: 'atom',
    todoFamily: 'atomFamily',
    settingsAtom: 'atom',
    postsCountFamily: 'atomFamily',
    tempCelsiusAtom: 'atom',
    refreshTickAtom: 'atom',
    doubleSelector: 'selector',
    userNameSelector: 'selector',
    todoStatsSelector: 'selector',
    userPostsSelector: 'selector',
    searchResultsFamily: 'selectorFamily',
    dashboardSelector: 'selector',
    postsPreviewSelector: 'selector',
    tempFahrenheitSelector: 'selector',
  });
  assert.equal(inventory.totals.features, 17);
  assert.equal(inventory.totals.byKind.selectorFamily, 1);
});

test('reads keys, exports and definition flags', () => {
  assert.equal(byName.counterAtom.key, 'counter');
  assert.equal(byName.counterAtom.exported, true);
  assert.equal(byName.themeAtom.flags.hasEffects, true);
  assert.equal(byName.themeAtom.flags.effectsCount, 1);
  assert.equal(byName.settingsAtom.flags.defaultKind, 'selector');
  assert.equal(byName.postsCountFamily.flags.defaultKind, 'selectorFamily');
  assert.equal(byName.postsCountFamily.flags.isAsync, true);
  assert.equal(byName.todoFamily.flags.defaultKind, 'function');
  assert.equal(byName.todoFamily.flags.paramKind, 'primitive');
  assert.equal(byName.searchResultsFamily.flags.paramKind, 'object');
  assert.equal(byName.searchResultsFamily.flags.paramType, 'SearchParams');
  assert.equal(byName.searchResultsFamily.flags.isAsync, true);
  assert.equal(byName.userPostsSelector.flags.isAsync, true);
  assert.equal(byName.userPostsSelector.flags.hasCachePolicy, true);
  assert.equal(byName.tempFahrenheitSelector.flags.hasSet, true);
  assert.equal(byName.tempFahrenheitSelector.flags.usesDefaultValue, true);
  assert.deepEqual(byName.dashboardSelector.flags.usesWaitFor, ['waitForAll']);
  assert.equal(byName.postsPreviewSelector.flags.usesNoWait, true);
  assert.equal(byName.doubleSelector.flags.isAsync, false);
  assert.equal(byName.doubleSelector.flags.maybeAsync, false);
});

test('resolves dependencies across files, through wrappers and nested defaults', () => {
  const deps = (name) => names(byName[name].deps.map((d) => d.id));
  assert.deepEqual(deps('doubleSelector'), ['counterAtom']);
  assert.deepEqual(deps('userNameSelector'), ['userAtom']);
  assert.deepEqual(deps('todoStatsSelector'), ['todoFamily', 'todoIdsAtom']);
  assert.deepEqual(deps('userPostsSelector'), ['refreshTickAtom', 'userAtom']);
  assert.deepEqual(deps('searchResultsFamily'), ['userAtom']);
  assert.deepEqual(deps('dashboardSelector'), ['settingsAtom', 'userPostsSelector']);
  assert.deepEqual(deps('postsPreviewSelector'), ['userPostsSelector']);
  assert.deepEqual(deps('tempFahrenheitSelector'), ['tempCelsiusAtom']);
  assert.deepEqual(deps('settingsAtom'), ['userAtom'], 'dependency inside a nested default selector');
  assert.deepEqual(deps('postsCountFamily'), []);
  assert.equal(byName.dashboardSelector.deps.find((d) => d.id.endsWith('#userPostsSelector')).wrapper, 'waitForAll');
  assert.equal(byName.postsPreviewSelector.deps[0].wrapper, 'noWait');
  assert.equal(byName.todoStatsSelector.deps.find((d) => d.id.endsWith('#todoFamily')).familyCall, true);
  assert.deepEqual(names(byName.userAtom.dependents), ['searchResultsFamily', 'settingsAtom', 'userNameSelector', 'userPostsSelector']);
});

test('classifies consumers by hook, callback op, imperative write and plain reference', () => {
  assert.deepEqual(roles('userPostsSelector'), {
    'Posts.tsx': { useRecoilValueLoadable: 1, useRecoilRefresher_UNSTABLE: 1 },
    'TodoList.tsx': { 'useRecoilCallback:refresh': 1 },
    'selectors.test.ts': { 'snapshot:getPromise': 1 },
  });
  assert.deepEqual(roles('counterAtom'), {
    'Counter.tsx': { ref: 1, useResetRecoilState: 1 },
    'selectors.test.ts': { 'imperative:set': 1 },
  });
  assert.deepEqual(roles('todoIdsAtom'), {
    'TodoList.tsx': { 'useRecoilCallback:getPromise': 2, 'useRecoilCallback:set': 1, 'useRecoilCallback:reset': 1 },
    'selectors.test.ts': { 'imperative:set': 1 },
  });
  assert.deepEqual(roles('todoFamily'), {
    'TodoList.tsx': { 'useRecoilCallback:set': 1, 'useRecoilCallback:reset': 1 },
    'selectors.test.ts': { 'imperative:set': 2 },
  });
  assert.equal(roles('userAtom')['App.tsx']['imperative:set'], 1, 'initializeState set counts as an imperative write');
  assert.deepEqual(roles('userAtom')['Dashboard.tsx'], { useRecoilValue: 1 });
  assert.deepEqual(roles('settingsAtom'), { 'Settings.tsx': { useRecoilStateLoadable: 1 } });
  assert.deepEqual(roles('doubleSelector')['selectors.test.ts'], { 'snapshot:getLoadable': 1 });
  const search = byName.searchResultsFamily.consumers.find((c) => c.file.endsWith('Search.tsx'));
  assert.equal(search.familyParamLiteral, true, 'object literal passed to a family in render');
  assert.equal(byName.counterAtom.consumers.find((c) => c.file.endsWith('selectors.test.ts')).isTest, true);
  assert.equal(byName.counterAtom.hasTests, true);
  assert.equal(byName.themeAtom.hasTests, false);
});

test('counts API usage, loadable idioms and decisions', () => {
  assert.equal(inventory.apiUsage.useRecoilCallback.count, 2);
  assert.equal(inventory.apiUsage.RecoilRoot.count, 1, 'JSX closing tag is not a second use');
  assert.equal(inventory.apiUsage.snapshot_UNSTABLE.category, 'snapshot');
  assert.equal(inventory.apiUsage.Loadable.category, 'type');
  assert.equal(inventory.apiUsage.RecoilState.count, 1);
  assert.equal(inventory.apiUsage.DefaultValue.category, 'util');
  assert.equal(inventory.loadableIdioms.valueMaybe.count, 1);
  assert.ok(inventory.loadableIdioms['.contents'].count >= 3);
  assert.ok(inventory.loadableIdioms.valueOrThrow.count >= 5);
  assert.equal(inventory.decisions['atom effects'].count, 1);
  assert.equal(inventory.decisions['RecoilRoot initializeState'].count, 1);
  assert.equal(inventory.decisions['families with object params'].count, 1);
  assert.equal(inventory.decisions['unresolved dependencies'], undefined);
  assert.equal(inventory.versions.recoil.declared, '0.7.7');
  assert.equal(inventory.versions.jotai.declared, '3.0.1');
  assert.equal(inventory.totals.filesImportingRecoil, 13);
});

test('scores ease with reasons; test files never lower the score', () => {
  assert.equal(byName.counterAtom.ease.score, 5);
  assert.deepEqual(byName.counterAtom.ease.reasons, []);
  assert.equal(byName.themeAtom.ease.score, 4);
  assert.deepEqual(byName.themeAtom.ease.reasons, ['effects']);
  assert.equal(byName.searchResultsFamily.ease.score, 1, 'selectorFamily(3) - object param - loadable consumers');
  assert.deepEqual(byName.tempFahrenheitSelector.ease.reasons, ['DefaultValue reset']);
  assert.deepEqual(byName.userPostsSelector.ease.reasons, ['loadable consumers', 'imperative consumers']);
  assert.deepEqual(byName.settingsAtom.ease.reasons, ['derived default', 'loadable consumers']);
  assert.deepEqual(byName.userAtom.ease.reasons, ['imperative consumers']);
});

test('splits the graph into free features and connected components with waves and bridges', () => {
  assert.deepEqual(names(inventory.plan.free), ['postsCountFamily', 'themeAtom']);
  const comps = inventory.plan.components.map((c) => names(c.members));
  assert.deepEqual(comps[0], ['dashboardSelector', 'postsPreviewSelector', 'refreshTickAtom', 'searchResultsFamily', 'settingsAtom', 'userAtom', 'userNameSelector', 'userPostsSelector']);
  assert.ok(comps.some((c) => c.join() === ['counterAtom', 'doubleSelector'].join()));
  assert.ok(comps.some((c) => c.join() === ['todoFamily', 'todoIdsAtom', 'todoStatsSelector'].join()));
  assert.ok(comps.some((c) => c.join() === ['tempCelsiusAtom', 'tempFahrenheitSelector'].join()));

  const big = inventory.plan.components[0];
  assert.equal(big.direction, 'sinks-first');
  assert.equal(big.atomic, true, '8 features is still within the atomic threshold');
  assert.equal(big.cycles.length, 0);
  assert.deepEqual(names(big.waves[0].features), ['dashboardSelector', 'postsPreviewSelector', 'searchResultsFamily', 'userNameSelector']);
  assert.deepEqual(names(big.waves[0].newBridges), ['settingsAtom', 'userAtom', 'userPostsSelector']);
  assert.deepEqual(names(big.waves[1].features), ['settingsAtom', 'userPostsSelector']);
  assert.deepEqual(names(big.waves[1].retiredBridges), ['settingsAtom', 'userPostsSelector']);
  assert.deepEqual(names(big.waves[1].newBridges), ['refreshTickAtom']);
  assert.deepEqual(names(big.waves[2].features), ['refreshTickAtom', 'userAtom']);
  assert.equal(big.waves[2].aliveBridges, 0);
  assert.equal(big.maxAliveBridges, 3);
  assert.equal(big.otherDirectionMaxAliveBridges, 4, 'sources-first would need one more bridge alive');
  assert.equal(byName.userAtom.wave, 3);
});

test('writes a markdown report', () => {
  const md = readFileSync(join(outDir, 'recoil-inventory.md'), 'utf8');
  assert.match(md, /^# Recoil → Jotai inventory/);
  assert.match(md, /\| `searchResultsFamily` \| selectorFamily \| 1 \|/);
  assert.match(md, /### Component 1 — 8 features/);
  assert.match(md, /## Ease rubric/);
});

test('hub cut shatters a star-shaped component into small fragments', async () => {
  const { hubCut } = await import('./inventory.mjs');
  // hub H is read by 12 selectors; each selector is read by one more selector (24 nodes + hub)
  const deps = new Map([['H', []]]);
  for (let i = 1; i <= 12; i += 1) {
    deps.set(`s${i}`, [{ id: 'H', via: 'get' }]);
    deps.set(`t${i}`, [{ id: `s${i}`, via: 'get' }]);
  }
  deps.set('w', [{ id: 'H', via: 'set' }, { id: 's1', via: 'get' }]);
  const ids = [...deps.keys()];
  const depsOf = (id, detailed = false) => deps.get(id).map((d) => (detailed ? d : d.id));
  const dependentsOf = (id) => ids.filter((other) => deps.get(other).some((d) => d.id === id));
  const cut = hubCut(ids, depsOf, dependentsOf, 3);
  assert.deepEqual(cut.hubs.map((h) => h.id), ['H']);
  assert.equal(cut.hubs[0].degree, 13);
  assert.equal(cut.fragments.length, 12);
  assert.equal(cut.fragments[0].size, 3, 's1 + t1 + w stay together');
  assert.deepEqual(cut.fragments[0].readsHubs, ['H']);
  assert.deepEqual(cut.fragments[0].writesHubs, ['H']);
  assert.equal(cut.anyFragmentWritesHub, true);
  assert.equal(cut.bridgesAlive, 1);
});

test('plans waves for a chain and reports cycles', async () => {
  const { planWaves } = await import('./inventory.mjs');
  const deps = new Map([['a', []], ['b', ['a']], ['c', ['b']], ['x', ['y']], ['y', ['x']]]);
  const ids = [...deps.keys()];
  const depsOf = (id) => deps.get(id);
  const dependentsOf = (id) => ids.filter((o) => deps.get(o).includes(id));
  const sinks = planWaves(ids, depsOf, dependentsOf, 'sinks-first');
  assert.deepEqual(sinks.waves.map((w) => w.features.sort()), [['c', 'x', 'y'], ['b'], ['a']]);
  assert.equal(sinks.cycles.length, 1);
  assert.deepEqual(sinks.cycles[0].sort(), ['x', 'y']);
  const sources = planWaves(ids, depsOf, dependentsOf, 'sources-first');
  assert.deepEqual(sources.waves.map((w) => w.features.sort()), [['a', 'x', 'y'], ['b'], ['c']]);
});

test('hub cut prefers atoms and selectors over families at equal degree', async () => {
  const { hubCut } = await import('./inventory.mjs');
  const deps = new Map([['A', []], ['F', []]]);
  for (let i = 1; i <= 6; i += 1) deps.set(`a${i}`, [{ id: 'A', via: 'get' }]);
  for (let i = 1; i <= 6; i += 1) deps.set(`f${i}`, [{ id: 'F', via: 'get' }]);
  deps.set('link', [{ id: 'A', via: 'get' }, { id: 'F', via: 'get' }]);
  const ids = [...deps.keys()];
  const depsOf = (id, detailed = false) => deps.get(id).map((d) => (detailed ? d : d.id));
  const dependentsOf = (id) => ids.filter((o) => deps.get(o).some((d) => d.id === id));
  const cut = hubCut(ids, depsOf, dependentsOf, 8, (id) => id === 'F');
  assert.deepEqual(cut.hubs.map((h) => h.id), ['A'], 'A and F tie on degree; the family is weighted down');
});
