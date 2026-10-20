# Eval results — iteration 1 (2026-10-20)

Three prompts, each run by a fresh agent with the skill and without it, on a copy of
`examples/recoil-app` (node_modules symlinked, no network, Jotai 3.0.1 installed). Outputs were
graded by a script for the objective assertions (`tsc`, `vitest`, greps, `git diff` file sets) and
by an independent grader for the two assertions that need judgement; the migrated code of evals
1 and 3 was also compared blind (A/B labels only) by a reviewer that never saw the prompts' arms.

| Eval | Prompt | With skill | Without skill | Blind verdict |
| --- | --- | --- | --- | --- |
| 1 | migrate the whole kata to Jotai 3 | **10/10** · 229k tokens · 20.7 min | 8/10 · 165k · 13.2 min | with skill 9.3 vs 7.7 |
| 2 | plan only, no code changes | **8/8** · 202k · 16.6 min | 6/8 · 196k · 18.1 min | with skill (accuracy, order, decisions) |
| 3 | move only counter + thermostat, keep the rest on Recoil | **8/8** · 160k · 8.7 min | 7/8 · 138k · 10.5 min | without skill 9.3 vs 9.0 |

Pass rate: **26/26 (100%)** with the skill, **21/26 (81%)** without. Tokens: +19% with the skill
on average; wall time: −8% (the plan-only and slice runs were faster with the skill, the full
migration slower because the skill made it run the gate after every component).

## What the skill changed

- Eval 1 baseline created `loadable()` wrappers in render and inside a read function and kept
  `createJSONStorage`'s cross-tab `subscribe`, which a probe showed accepts an unvalidated `"blue"`
  theme from a `storage` event; the skill run hoisted the wrappers and stripped `subscribe` for
  parity. Both runs got `areEqual`, `atomWithStorage` + validator, `useHydrateAtoms`,
  `atomWithRefresh` and the ported tests right.
- Eval 2 baseline proposed moving `settingsAtom` to Jotai one step before `dashboardSelector`,
  which still reads it through `waitForAll`, and claimed each step would be green; the skill run's
  order followed the dependency graph (isolated features, then whole components), stated that the
  storage key and layout must be preserved for existing users, and caught `onClick={refresh}`
  passing the click event into an `atomWithRefresh` setter (throws in development).
- Eval 3: identical runtime result. The skill run lost a point for renaming exports, relocating
  the two tests and leaving the generated `.recoil-to-jotai/` folder in the tree; the baseline for
  editing the README outside the asked slice. Both are now addressed in `SKILL.md` (keep names and
  test locations in a step; no tool residue in the diff).

## What the evals changed in the skill

- A false claim removed: `loadable(x)` inside render does **not** create a new atom per render
  (it is memoised per source atom); `unwrap`/`selectAtom` with inline functions and family
  members keyed by fresh objects do.
- Wave 0 is now "what the first change needs", not the full scaffolding list.
- The hydration seam is a wrapper that renders its children, not a sibling that must stay first.
- Cross-tab sync from `atomWithStorage`'s default storage is called out as a parity decision.

## Caveats

- Baseline agents could see the skill's name and description in the session's skill list
  (a private copy was registered while the runs were in flight); all three reported declining to
  load it. Re-run baselines with the copy removed for a cleaner iteration 2.
- One iteration, one model, one small fixture (17 features, four components all ≤ 8). The
  bridge and hub-cut machinery was exercised only by the real-project dry run, not by these evals.
- Eval 1 / eval 3 contain one assertion that is process rather than outcome ("the inventory ran
  before editing"); it discriminates the skill's method, not the code's correctness.

## Real-project dry run (same day)

The private copy of the skill, with a project overlay, migrated one component
(`adminPaymentsSelector` + its refresh counter) of a 213-feature Next.js app in a clean worktree:
3 files, +30/−26, eslint green, inventory diff = exactly the two features. Its 15-item feedback
list drove the fixes in `scripts/inventory.mjs` (cwd-relative output, portable ids, refresh-counter
detection, the "check each use" table, no bridge table for atomic components) and in the texts.
