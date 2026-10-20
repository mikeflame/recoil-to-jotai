---
name: recoil-to-jotai
description: Migrate a React code base from Recoil (archived, no React 19 support) to Jotai incrementally and verifiably. Inventories every atom, selector and family with a dependency graph, consumer roles, a documented ease score and a migration plan (free features, atomic components, hub cut or waves with bridges); maps each Recoil API to Jotai v2 and v3; handles the hard cases (SSR hydration, atom effects and persistence, object-param families, loadables, useRecoilCallback, refreshers, DefaultValue and reset, cache semantics, tests); gates every step. Use whenever a project has `recoil` in package.json and the user mentions migrating, replacing, removing or modernising state management, Jotai, RecoilRoot, atomFamily or selectorFamily, a React 19 upgrade blocked by Recoil, or jotai-recoil-compat — even if they never say "migrate".
---

# Recoil → Jotai

Recoil is archived; Jotai has the same atomic model with a smaller, maintained API. The
migration is not a find-and-replace, for three reasons that shape everything below:

1. **The two runtimes cannot read each other.** A Jotai atom cannot `get` a Recoil atom, nor the
   reverse. A feature can only move when everything it reads and everything that reads it has
   moved — or a bridge carries the value. Components may use both runtimes; definitions may not.
2. **Families compare parameters differently.** Recoil by value, Jotai by reference. A family
   called with an object literal works in Recoil and creates an atom per render in Jotai.
3. **Effects, loadables, snapshots and `DefaultValue` have no 1:1 equivalent.** Each needs a
   decision, and the inventory finds every place one is needed.

If `references/project.md` exists next to this file, read it first: it carries the project's own
decisions (folders, SSR policy, storage layout, pending questions) and overrides the defaults here.

## Step 1 — Inventory

Run the scanner from the repository root; it uses the project's own `typescript` (resolved from
the package that owns `<srcRoot>`) and needs no install:

```bash
node <skill>/scripts/inventory.mjs <srcRoot>          # e.g. src, frontend, apps/web/src
cp .recoil-to-jotai/recoil-inventory.json .recoil-to-jotai/baseline.json
```

Output lands in `./.recoil-to-jotai/` under the directory you ran it from (`--out` changes that);
the scanner prints the paths. Add the folder to `.gitignore`, or commit only `baseline.json`.

Read `references/inventory.md` for what each section means, then read the report. Before
proposing anything, tell the user what you found, in this shape (the names in angle brackets
are fields of the report):

```
Recoil inventory: <totals.features> features (<byKind>) in <filesImportingRecoil> files (the files the migration touches).
Versions: recoil x, jotai y (or none), react z, typescript t → target Jotai <major> because … (or: fixed by the project overlay).
Plan from the graph: <free> free features; <atomic components> small components (one change each); largest component <size> →
  hub cut: <hubs> hubs (<names>), <fragments> fragments of ≤ <largest>, <hubs> bridges alive, order <hubs-first|hubs-last>;
  waves alternative: <waves> waves, <max alive> bridges alive.
Needs a decision: <one line per row of that table, with its count>.
Check each use: <one line per row of the "mechanical, but check" table, with its count>.
Loadable idioms: <sum of the idiom table> uses across <files> files change shape.
```

## Step 2 — Strategy and decisions

Read `references/strategies.md` and propose one strategy (native bottom-up, engine swap with
`jotai-recoil-compat`, or hybrid) with the inventory numbers as the argument. Then put every
open decision to the user in one go and wait for the answers (use the question tool when the
harness has one):

- Jotai major (v2 vs v3; React ≥ 18 and TypeScript ≥ 5.5 are required for v3) and, for v3,
  `jotai-family` / `jotai-loadable`.
- Each "Needs a decision" row: effects (storage layout compatibility for existing users),
  `initializeState` (hydration seam), object-param families (equality + eviction), snapshot or
  transaction APIs, cross-runtime reads, unresolved dependencies.
- For the large component: hub cut or waves, and the order (`hubs-first` / `hubs-last`,
  `sinks-first` / `sources-first`). Default to the hub cut when it needs fewer bridges.
- Batch size per change (one fragment or wave per PR is the default) and which verification
  commands count as the gate in this project (typecheck, lint, unit tests, e2e subset).

Do not start editing before the answers; a migration that guesses the storage layout or the
SSR policy is the one that gets reverted. When the project overlay already records a decision
or the strategy, treat it as answered: say which overlay line settles it instead of asking again.

## Step 3 — Wave 0: scaffolding

Land what the first change needs before the first feature moves, in its own change. The list
below is the full set for a large code base; a small one or a first slice takes only the items
its features will use (the Provider is always needed; the seam only once a hydrated atom moves;
helpers and the bridges folder only when a consumer or a wave calls for them) — say which items
you deferred and why.

- Install `jotai` (and `jotai-family`, `jotai-loadable` for v3). Keep `recoil` installed.
- Mount a Jotai `<Provider>` **inside** `RecoilRoot` (so bridge components can use both). On SSR
  frameworks create the store once per app instance and read `references/hard-cases.md` § 3
  before deciding whether the server renders the Provider at all.
- Add the hydration seam: a wrapper component inside the Provider that calls `useHydrateAtoms`
  with the same server values `initializeState` sets and then renders its children (a wrapper,
  not a sibling, so nothing can render before the hydration by accident), plus an effect that
  re-syncs props that change on client navigation. Nothing uses it yet; it is the landing zone.
- Add `state/jotai/` helpers that the mappings will need: the loadable helper module
  (`valueMaybe`, `errorMaybe`), a `familyAtom` wrapper that always passes a deep-equal
  `areEqual` and a `setShouldRemove` policy, the storage adapter that preserves the existing
  storage layout, and an empty `bridges/` folder with the `Mirror`/`Shadow` component from
  `references/hard-cases.md` § 1.
- Test runner settings: Jotai 3 is ESM-only (Jest `transformIgnorePatterns`); remove any module
  alias that would shadow `jotai/*`.
- Gate: typecheck and tests green with both runtimes mounted and no feature moved.

## Step 4 — Migrate, in the order the graph allows

Order: free features → small components (one atomic change each) → the large component by
its chosen cut. For a hub cut with `hubs-first`, the hubs and their consumers move as the first
large-component change with Recoil shadows; with `hubs-last`, fragments read Jotai mirrors of
the hubs and the hubs move last. For waves, each wave's new bridges land before its features.

Per feature, in this order:

1. **Definition.** Map it with `references/api-map.md` using the feature's row: kind, flags
   (`async`, `writable`, `effects`, `default:selector`, `param:object`, `waitForAll`, `noWait`,
   `refresh-counter`) and the ease reasons. Put the Jotai definition in the project's Jotai
   folder (the overlay names it; otherwise mirror the layout the project already uses, such as
   `<area>/jotai/`). Keep it in the same file as the Recoil definition only when the whole file
   moves in this change. Keep the exported names and the test locations the project has: a
   migration step is not the moment to rename `fooSelector` to `fooAtom` or to move tests into
   new files — note the rename as a follow-up for when Recoil is gone. Keep a read function
   synchronous when an SSR guard returns a value synchronously: marking it `async` turns that
   guard value into a pending promise and changes the server-rendered markup. Delete the Recoil
   definition in the same change once no consumer is left.
2. **Consumers.** The inventory lists every file and its roles. Hooks are mechanical;
   `useRecoilValueLoadable` consumers change shape (§ 6); callbacks, refreshers and imperative
   sets follow § 7 and § 5; `ref` roles (atoms passed to helpers or props) need the helper's
   type changed.
3. **Tests.** Port `snapshot_UNSTABLE` tests to `createStore()` (§ 9); keep the assertions. When
   no test touches the feature (`tests` missing from its row) and it is async, writable or
   persisted, write one store-level test before moving it: the port is the proof that the
   mapping preserved behaviour.
4. **Remove the `recoil` import** from every touched file. A file that still imports both after
   the change is either a bridge or a mistake.

Per change (fragment, component or wave), the gate — all of it, every time:

- typecheck (where the project runs it only in CI, say so and name the job) and the project's
  lint on changed files;
- unit tests for the touched state, plus the project's chosen e2e subset when consumers are UI;
  when no test touches the change, report `tests: none touch this change` and why that is fine;
- `node <skill>/scripts/inventory.mjs <srcRoot> --baseline .recoil-to-jotai/baseline.json`:
  the "gone" list must equal the features of this change, no more, no fewer, and "Needs a
  decision" must not have grown;
- for waves: the retired bridges of this wave are deleted, and no bridge's source has migrated.

Then commit with a message that names the features moved and the bridges added/removed. The
diff must contain the migration and nothing else: no generated `.recoil-to-jotai/` reports
(gitignored, or only `baseline.json` tracked), no drive-by refactors. Report to the user:

```
Moved: <features> (<kind counts>) in <n> files; bridges added/removed: …
Gate: typecheck ✓ | CI <job> · lint ✓ · tests <passed/total> ✓ | none touch this change · inventory: <gone> of <baseline> gone (<pct>%), decisions unchanged
Next: <next fragment/wave and why>
```

Stop and ask when a feature's behaviour would change in a way the mapping cannot preserve
(cache semantics for an expensive async selector, storage layout, a snapshot API). Do not
"approximate and move on": name the difference and let the user choose.

## Step 5 — Finish

When the inventory lists no features: remove `RecoilRoot` (the hydration seam replaces
`initializeState`), every bridge, `recoil` and its extras from `package.json`, `RecoilEnv`
tweaks, Jest aliases and `recoil`-named folders. Then:

```bash
node <skill>/scripts/inventory.mjs <srcRoot> --check   # exits 1 while any file imports recoil
```

Only now is a React 19 upgrade unblocked by state management.

## Pitfalls that cost real migrations weeks

- Migrating a selector before its dependencies without a bridge; it has nothing to read.
- `loadable(x)` or `atomFamily` members created inside render: new atom per render.
- Families keyed by objects without `areEqual`; family maps never evicted on a server.
- Async atoms read during SSR without a guard or hydration: wasted requests, or a suspended
  server render.
- `atomWithStorage` with a different key layout than the effect it replaces: users lose data.
- A writable derived atom that ignores `RESET`: reset silently does nothing.
- Dropping `cachePolicy_UNSTABLE` on an expensive selector without checking toggling cost.
- `atomWithRefresh` setters take no argument: `onClick={refresh}` hands them the event and
  throws in development; write `onClick={() => refresh()}`.
- Copying the project's existing Jotai code without reading it: an early migration attempt is
  where the pitfalls above were first made.
- Keeping both runtimes without a baseline-tracked plan: the migration stalls at the easy 20%.

## References

- `references/inventory.md` — reading the report and the JSON; what the scanner cannot see.
- `references/api-map.md` — every Recoil API with its Jotai v2 and v3 form.
- `references/hard-cases.md` — the seam and bridges, families, SSR, persistence, reset,
  loadables, callbacks, cache semantics, tests, finishing.
- `references/strategies.md` — native vs engine swap vs hybrid, with the decision table.
- `references/project.md` — the project overlay: present in a project's copy of this skill,
  absent in the public one; read first when it exists.
