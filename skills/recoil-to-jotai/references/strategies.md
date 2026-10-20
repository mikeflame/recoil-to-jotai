# Strategies

Three ways to get a Recoil code base onto Jotai. The inventory's totals and "Needs a decision"
table are the inputs; pick one strategy per code base (or per component of the graph) and say
which one you picked and why before touching code.

## A. Engine swap: `jotai-recoil-compat`

[`jotai-recoil-compat`](https://github.com/witbybit/jotai-recoil-compat) re-implements the
`recoil@0.7` public API on top of Jotai. The whole migration is a package alias:

```jsonc
"recoil": "npm:jotai-recoil-compat@^0.2.0",
"jotai": "^3.0.0"
```

Every `import … from 'recoil'` then runs on Jotai, including `jest.mock('recoil')`. Each atom and
selector is a real Jotai atom underneath, so native Jotai code can read them and the native
rewrite (strategy B) can proceed feature by feature with **no bridges**: the compat layer *is*
the bridge.

When it fits:

- The blocker is React 19 or an archived dependency, not Recoil's design, and the team wants the
  risk of a big rewrite spread over time.
- Inventory shows hundreds of features, many `useRecoilCallback`/snapshot/transaction uses, or
  effects everywhere — the APIs where a native rewrite needs the most judgement.
- Tests are thin, so behaviour parity matters more than code shape.

What to verify before trusting it (do this, do not assume):

1. `npx jotai-recoil-compat check <src>` lists every Recoil API you use with its support status.
   Anything "unsupported" is a native rewrite you do first.
2. Run the full test suite and the app under the alias, with attention to atom effects, async
   selectors with `cachePolicy_UNSTABLE`, `initializeState`, and families with object params:
   these are the places where "same API" can still mean "different timing".
3. Note the project's age and adoption at the time you read this (it appeared in October 2026
   with a parity suite against real Recoil). A new dependency under your whole state layer is a
   risk to name in the plan, not hide.

What it does not do: remove Recoil's semantics (keys, loadable classes, snapshot API) from your
code, or make the code base idiomatic Jotai. It buys time; strategy B still follows, feature by
feature, and with the compat layer in place every feature is "free" in the inventory's sense.

## B. Native rewrite, bottom-up by components (this skill's main path)

Move features to native Jotai in an order the dependency graph allows, verifying after every
step. The inventory gives the order:

1. **Free features** — no dependencies, no dependents. Any order, any batch size. This is where
   stalled migrations usually got to on their own.
2. **Small components** (≤ 8 features) — one change per component, definitions and consumers
   together, no bridge.
3. **Large components** — waves with bridges (`hard-cases.md` § 1). Default `sinks-first`.
   Compare the max-bridges-alive number the inventory prints for both directions and pick the
   smaller one unless there is a reason to own writes on Jotai early.

Per feature: read its row (kind, flags, ease reasons, consumers and their roles), map the
definition with `api-map.md`, rewrite each consumer file, port its tests, run the gates. Per wave:
add the wave's new bridges first, migrate, delete the retired bridges, re-run the inventory with
`--baseline` and confirm the "gone" list is exactly the wave.

When it fits: almost always. It is the only strategy that ends with idiomatic Jotai and no extra
dependency. Its cost is proportional to the sum of the ease penalties, and it needs the test
suite (or a manual check list) to be real.

## C. Hybrid

Engine-swap only the largest component (or the whole app) to unblock React 19 this week, then
peel features natively with strategy B. Or: native for free features and small components now,
compat for the giant component later if it stalls. The inventory's component table makes the cut
explicit: name the components under each strategy in the plan.

## Decision table

| Signal from the inventory | Leans to |
| --- | --- |
| ≤ 60 features, ≤ 3 items in "Needs a decision" | B, in a few PRs |
| Largest component > 50 and max bridges alive > 10 in both directions | A or C for that component |
| `useRecoilSnapshot` / transactions / `useRecoilBridgeAcrossReactRoots` in use | A first; those have no native equivalent |
| Many atom effects with a shared storage blob | B, but settle the storage layout (`hard-cases.md` § 4) before wave 1 |
| React 19 upgrade is the deadline | A to unblock, B afterwards |
| SSR (Next.js, Remix) with families keyed per request | B, and fix family eviction in wave 0 regardless of strategy |
| No tests on the state layer | A, or write store-level tests for the component before moving it |

Record the verdict and its reason in the project overlay (`references/project.md`) so Step 2 does
not reopen the question on every run; a table row is a lean, not a rule, and a code base that hits
"A or C" may still choose B for a reason worth writing down.

## What not to do

- One big-bang PR that rewrites every file. It cannot be reviewed, bisected, or shipped behind a flag.
- Migrating a selector before its dependencies without a bridge: it has nothing to read.
- Keeping both runtimes "for a while" without a baseline-tracked plan; that is how a migration
  ends at 20% with two state libraries in production for a year.
- Reaching for `jotai-recoil-adapter`: unmaintained since January 2024, provider-less only, no effects.
