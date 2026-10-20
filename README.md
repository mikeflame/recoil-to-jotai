# recoil-to-jotai

An agent skill that migrates a React code base from [Recoil](https://github.com/facebookexperimental/Recoil)
(archived January 2025, no React 19 support) to [Jotai](https://jotai.org) — incrementally, in
an order the dependency graph allows, with a gate after every step.

It is built from a real migration of a 200-feature Next.js app that had stalled at 20% because
the two runtimes cannot read each other: a Jotai atom cannot `get` a Recoil atom, so a feature
can only move when everything it reads and everything that reads it has moved — or a bridge
carries the value. The skill makes that graph visible and plans around it.

## What you get

- **`scripts/inventory.mjs`** — a scanner that uses your project's own `typescript` (no install)
  and, in seconds, lists every atom, selector, `atomFamily` and `selectorFamily` with its
  dependencies, consumers and their roles (hook, callback op, imperative write, plain reference),
  every Recoil API in use, the Loadable idioms that will change shape, a documented 1–5 ease
  score per feature, and a migration plan: free features, atomic components, and for a large
  component either a **hub cut** (bridge a handful of high-degree atoms, let the rest fall apart
  into small atomic pieces) or **waves** with the bridges each wave needs. `--baseline` tracks
  progress; `--check` is the end-of-migration gate.
- **`references/api-map.md`** — every Recoil API with its Jotai v2 and v3 form (v3 moved
  `atomFamily` to `jotai-family` and removed `loadable`).
- **`references/hard-cases.md`** — the seam and bridge patterns, family equality and eviction,
  SSR hydration and store lifetime, atom effects and storage layout, reset and `DefaultValue`,
  loadables, `useRecoilCallback`, cache semantics, tests, finishing.
- **`references/strategies.md`** — native rewrite vs engine swap (`jotai-recoil-compat`) vs
  hybrid, with a decision table driven by the inventory numbers.
- **`examples/recoil-app`** — a 17-feature kata that plants every hard case; the skill's tests
  assert the inventory finds all of them, and the evals migrate it.

## Install

```bash
npx skills@latest add mikeflame/recoil-to-jotai --skill recoil-to-jotai   # any agent (skills.sh)
```

Claude Code plugin route (updates itself):

```bash
claude plugin marketplace add mikeflame/recoil-to-jotai
claude plugin install recoil-to-jotai@mikeflame
```

Then, in your project: *"We're on Recoil, migrate us to Jotai"* — or just run the inventory:

```bash
node .claude/skills/recoil-to-jotai/scripts/inventory.mjs src
```

## How a migration runs

1. **Inventory** — the scanner's report, summarised to you with the numbers.
2. **Strategy and decisions** — Jotai major, storage layout for persisted atoms, hydration seam,
   object-param families, snapshot APIs, hub cut vs waves. Nothing is edited before you answer.
3. **Wave 0** — Jotai Provider mounted inside `RecoilRoot`, hydration seam, helper modules,
   bridges folder, test-runner settings. Typecheck and tests green with both runtimes mounted.
4. **Migrate** — free features, then small components atomically, then the large component by
   its cut. Per change: typecheck, lint, tests, and the inventory diff against the baseline must
   equal exactly the features moved.
5. **Finish** — remove `RecoilRoot`, bridges, the package, aliases; `inventory.mjs --check` exits 0.

## Development

```bash
cd examples/recoil-app && npm install && npm run check        # the kata, green under Recoil
cd ../../skills/recoil-to-jotai && node --test scripts/       # scanner tests against the kata
```

MIT.
