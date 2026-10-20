# Reading the inventory

`scripts/inventory.mjs <srcRoot>` writes `recoil-inventory.json` and `recoil-inventory.md` into
`./.recoil-to-jotai/` under the directory you run it from (`--out` to change that; add the folder to
`.gitignore` or commit only `baseline.json`). The *project root* is the directory of the nearest
`package.json` above `<srcRoot>` — the package, not the repository, in a monorepo — and is where
`typescript`, `tsconfig.json` and the versions come from; paths in the report are relative to it.
The scan finishes in seconds even on thousands of files.

```bash
node scripts/inventory.mjs src                                  # first run: the baseline
node scripts/inventory.mjs src --baseline .recoil-to-jotai/baseline.json   # after a wave
node scripts/inventory.mjs src --direction sources-first        # compare bridge counts
node scripts/inventory.mjs src --check                          # final gate: exit 1 while any file imports recoil
RECOIL_TO_JOTAI_TS=/path/to/node_modules/typescript node scripts/inventory.mjs src   # typescript elsewhere
```

Copy the first JSON to `baseline.json` before the first change; every later run with
`--baseline` reports which features are gone (migrated or deleted) and which appeared.

## The markdown report, top to bottom

| Section | What to do with it |
| --- | --- |
| Versions | Decide the Jotai major you target (`api-map.md` has v2 and v3 columns). React < 18 or TS < 5.5 rules out Jotai 3. |
| Totals | Size the work. `filesImportingRecoil` is the number of files you will touch; `jotaiDefinitions` shows how far a previous attempt got. |
| Recoil API usage | The full count per API. Plain hooks are mechanical. |
| Mechanical, but check each use | Callbacks, refreshers, reset, loadables, `DefaultValue`, `noWait`/`waitFor*`, Recoil types: each has a mapping in `api-map.md`, and each use needs that row applied by hand. Quote the counts in the Step-1 summary. |
| Loadable idioms | How many consumer call sites change shape (`valueMaybe`, `.contents`, `'hasValue'`). Above a few dozen, add the helper module from `hard-cases.md` § 6. |
| Needs a decision | Items without a mechanical mapping: effects, `initializeState`, object-param families, snapshot APIs, extra packages, cross-runtime reads, unresolved dependencies. Each one is a sentence in the plan you show the user. |
| Migration plan | Free features, then components. Small components (≤ 8) move together in one change and show no bridge table (the JSON still carries their waves, for information). Large ones show the hub cut (hubs, fragments, batch-size options) and the waves alternative with new/retired/alive bridges for both directions. |
| Features | One row per feature, sorted by component, wave and ease. "Why" holds the ease reasons plus flags (`async`, `writable`, `effects×n`, `default:selector`, `param:object`, `ssr-guard`, `waitForAll`, `noWait`, `tests`). |
| Ease rubric | The scoring, so a reader can disagree with a number. |

## JSON fields worth knowing

- `features[]`: `id` (`relative/file.ts#name`, portable between checkouts), `name`, `kind`, `key`,
  `exported`, `file`, `line`, `flags` (including `refreshCounter`: an atom read only as a bare
  `get(x)` to force re-evaluation and never read by components — fold it with its selector into
  one `atomWithRefresh`), `deps[]` (`id`, `via` = get/set/reset/refresh, `wrapper` =
  waitForAll/noWait/…, `familyCall`, `paramLiteral`, `valueUnused`), `dependents[]`, `consumers[]`
  (`file`, `isTest`, `roles` = counts per hook or op, `familyParamLiteral`, `lines`),
  `unresolvedDeps[]`, `crossRuntimeDeps[]`, `ease` (`score`, `reasons`), `component`, `wave`,
  `fragment` (hub-cut fragment number or `hub`), `hasTests`.
- `attention`: the "mechanical, but check each use" counts per API.
- Consumer roles: the Recoil hook name; `useRecoilCallback:<op>` for `getPromise`, `getLoadable`,
  `set`, `reset`, `refresh` inside a callback; `imperative:set|reset` outside one (`initializeState`,
  `snapshot_UNSTABLE` initialisers, `snapshot.map`); `snapshot:<op>` for direct snapshot reads
  (tests); `ref` when the feature is passed around as a value (helper hooks, props).
- `plan.components[]`: `members`, `atomic`, `waves[]` (`features`, `newBridges`, `retiredBridges`,
  `aliveBridges`), `cycles[]` (strongly connected groups that must move together),
  `maxAliveBridges`, `otherDirectionMaxAliveBridges`.
- `decisions`: the "Needs a decision" table with file locations.
- `baseline`: `gone[]` and `added[]` as `name:kind` keys, so a feature that moves file is not
  counted as migrated.

## What it cannot see

- Values that reach `get()` through a variable or a helper (`get(pick(a, b))`) are not resolved;
  such features carry an `unresolved dep` penalty and show up under "Needs a decision".
- Async-ness is syntactic (`async`, `await`, `.then`, a direct `return someCall()`); `maybeAsync`
  means "looks like it, confirm".
- Type-level information: a family parameter typed through an alias is classified by its text
  (`SearchParams` → object, `number | string` → primitive).
- Anything built on top of Recoil's `RecoilLoadable` helpers, `useRecoilBridgeAcrossReactRoots`,
  or dynamically created atoms at runtime is counted as API usage, not as features.
