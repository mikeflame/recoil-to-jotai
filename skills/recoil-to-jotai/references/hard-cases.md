# Hard cases

The mappings in `api-map.md` are mechanical. These are the places where a migration breaks,
leaks, or silently changes behaviour, each with the pattern that survives. Read the sections
the inventory's "Needs a decision" table and the feature flags point you to.

## 1. Two runtimes, one graph: the seam

A Jotai atom cannot `get` a Recoil atom and a Recoil selector cannot `get` a Jotai atom.
Components can use hooks from both. So the seam of the migration is the component tree, never
the definition graph: a feature can only move when everything it reads and everything that
reads it has moved, or a **bridge** carries the value across.

The inventory computes this for you:

- **Free features** (no dependencies, no dependents) move whenever you like.
- **Small components** (≤ 8 features) move in one change. No bridge.
- **Large components** are cut into waves. Each wave lists the bridges it needs.

Two bridge directions, pick one per component and stay with it:

| Direction | Order | Bridge | Source of truth during the migration |
| --- | --- | --- | --- |
| `sinks-first` (default) | leaves of the read graph first (features nothing else reads) | a Jotai **mirror** of a still-Recoil value | Recoil, until the last wave |
| `sources-first` | primitives first | a Recoil **shadow** of an already-Jotai value | Jotai, from the first wave |

Prefer `sinks-first`: writes keep one owner, async values bridge cleanly (a Jotai primitive atom
can hold a promise), and the final wave removes every bridge. Use `sources-first` when the
primitives have few readers but many writers that you want on Jotai early.

A mirror:

```tsx
// state/bridges/userAtom.ts — delete when userAtom itself migrates
import { atom } from 'jotai';
export const userMirrorAtom = atom<User | null>(null);

// state/bridges/RecoilToJotai.tsx — render once, inside both roots
function Mirror<T>({ source, target }: { source: RecoilValue<T>; target: PrimitiveAtom<T> }) {
  const value = useRecoilValue(source);
  useHydrateAtoms([[target, value]]); // first render, including SSR: no lag
  const set = useSetAtom(target);
  useEffect(() => set(value), [value, set]); // later changes: one commit of lag
  return null;
}

export function RecoilToJotai() {
  return (
    <>
      <Mirror source={userAtom} target={userMirrorAtom} />
    </>
  );
}
```

For an async Recoil selector use `useRecoilValueLoadable` and set the mirror to the value, to
`loadable.toPromise()` while loading, and to `Promise.reject(loadable.contents)` on error: Jotai
readers of the mirror then suspend or throw exactly like readers of the original.

Rules that keep bridges from becoming a second migration:

- A mirror is read-only by convention. Nothing on the Jotai side writes it; writes still go to
  the Recoil atom through its existing setters.
- Name bridges `*MirrorAtom` / `*ShadowAtom` and keep them in one `bridges/` folder, so the final
  "no bridge left" check is a directory listing.
- A bridge whose source has migrated is a leak. Re-run the inventory with `--baseline` after
  every wave; the retired-bridges column tells you which ones to delete now.
- Expect one React commit of lag between a Recoil write and the Jotai mirror, and the reverse
  for shadows. Form inputs that drive derived displays will show the previous value for one
  frame during the migration; it disappears with the bridge.

## 2. Families: value equality, eviction, servers

Recoil compares family parameters **by value** (serialised): `fam({ q, page })` called with a
fresh object literal on every render returns the same selector. Jotai's `atomFamily` compares
**by reference** (`Object.is`) unless you pass `areEqual`. Without it, every render creates a
new atom, subscriptions never stabilise, and the family's internal `Map` grows forever.

```ts
import deepEqual from 'fast-deep-equal';
export const searchResultsFamily = atomFamily(
  (params: SearchParams) => atom(async (get) => api.search({ ...params, userId: get(userAtom)?.id })),
  deepEqual,
);
```

The inventory flags every family with a non-primitive parameter (`param:object`) and every
call site that passes an object literal (`familyParamLiteral`). Treat both as blocking.

Eviction: Recoil's `cachePolicy_UNSTABLE` bounds a selector's result cache, not the family
map, and Jotai's family map has no bound either. Each new parameter is a new atom kept for the
life of the module. In a browser that is a slow leak; on a server it is a fast one, because the
module-level map is shared by every request (one production app measured +1 600 closures per
minute until the family caches were evicted). Use `setShouldRemove((createdAt) =>
Date.now() - createdAt > TTL)` or `family.remove(param)` when the owning screen unmounts, and
never create family members during SSR for request-specific parameters.

`atomFamily` with a derived default: `atomFamily((p) => atomWithDefault((get) => get(derivedFamily(p))))`
keeps the Recoil semantics (follows the derived value until set, resettable).

## 3. Async atoms, Suspense and SSR

Reading an async atom suspends, like reading an async selector. During SSR, Recoil started the
selector's promise and never awaited it, so every async selector touched by a page fired a
wasted request (34 of them in one app, 5–15 requests per server render). Jotai is no different:
an async read during server rendering starts the fetch and, outside a Suspense boundary the
framework can stream, throws. Keep the existing SSR guards (`if (typeof window === 'undefined')
return EMPTY`) or, better, hydrate the server-fetched value with `useHydrateAtoms` and make the
read conditional on it.

Store lifetime on a server:

- Provider-less Jotai uses one process-wide store: request A's user leaks into request B. Never.
- `<Provider>` without a `store` prop creates a store per Provider instance, so one per request.
  Create it once per app instance (`useState(() => createStore())` or a lazily filled ref) so
  re-renders don't replace it.
- A store per request is safe only if module-level caches are bounded (§ 2) — the stores are
  garbage, the family maps are not.
- If every Jotai atom in the app is client-only, rendering `children` without a Provider on the
  server (and with one on the client) sidesteps the problem entirely; that is a legitimate
  interim choice, documented in the code.

Hydration from page props (Next.js pages router, Remix loaders): `useHydrateAtoms` runs once per
store, during the first render, so the SSR output and the first client render agree. It does
not re-run when props change on client-side navigation; keep a small effect component that
`useSetAtom`s the changed props (the equivalent of a `PagePropsSyncer` next to `RecoilRoot`).

## 4. Persistence and other atom effects

A storage effect does four things; `atomWithStorage` does them differently:

| Effect behaviour | `atomWithStorage` |
| --- | --- |
| read on `trigger === 'get'` (synchronously, before first render) | `getOnInit: true`. Default `false` renders the initial value first and loads storage in `onMount`, which avoids hydration mismatches on SSR. Decide per atom. |
| `onSet` → `storage.setItem` | built in |
| `onSet` with `isReset` → `storage.removeItem` | built in: writing `RESET` removes the item |
| `validate(saved)` returning `new DefaultValue()` on bad data | `unstable_withStorageValidator(isValid)(createJSONStorage(() => localStorage))`, or a custom storage whose `getItem` returns `initialValue` when validation fails |

Storage **layout** is the trap. `recoil-persist` and hand-written variants often keep *one* JSON
blob under one key (`{ [atomKey]: value, … }`); `atomWithStorage` keeps one entry per atom. Users
who already have data will lose it on deploy unless you either write a custom storage object
that reads and writes the old blob, or run a one-time migration on first load. Decide this
before the first persisted atom moves, and write it down in the plan.

`sessionStorage`: `createJSONStorage(() => sessionStorage)`. Cross-tab sync is built into the
default `localStorage` storage through `subscribe`. Emulation/impersonation guards that
disabled persistence in Recoil wrap the storage object instead.

Non-storage effects (logging, syncing to an external store, `setSelf` from a subscription) map
to `atom.onMount = (setAtom) => { const unsub = external.subscribe(setAtom); return unsub }` or
to `jotai-effect`. Jotai 3 removed `setSelf` from read functions; `onMount` is the replacement.

## 5. Reset and `DefaultValue`

Resetting is opt-in in Jotai. Before moving an atom, look at the inventory roles: any
`useResetRecoilState`, `reset(x)` in a callback, or `instanceof DefaultValue` in a `set` means:

- primitive atoms: `atomWithReset(initial)`; `atomWithStorage` and `atomWithDefault` already accept `RESET`;
- writable derived atoms: type the write argument `T | typeof RESET` and forward `RESET` to the
  base atom (`set(base, value === RESET ? RESET : convert(value))`);
- `new DefaultValue()` from a validator becomes the initial value (or `RESET` when you are writing).

## 6. Loadables

Recoil's `Loadable` is a class with methods; Jotai's is a plain union. Consumers that call
`valueMaybe()`, `getValue()`, `errorMaybe()` or read `.contents` need rewriting, and `'hasValue'`
becomes `'hasData'`. When a code base has dozens of these, add a five-line helper module rather
than inlining the ternary everywhere:

```ts
import type { Loadable } from 'jotai/vanilla/utils/loadable'; // v3: from 'jotai-loadable'
export const valueMaybe = <T>(l: Loadable<T>) => (l.state === 'hasData' ? l.data : undefined);
export const errorMaybe = <T>(l: Loadable<T>) => (l.state === 'hasError' ? l.error : undefined);
```

Create `loadable(x)` atoms at module level next to `x`. A `loadable()` call inside a component
creates a new atom each render, which re-subscribes and re-suspends.

Jotai 3 removed `loadable` from `jotai/utils`. Use the `jotai-loadable` package, the userland
version from the v3 migration guide, or `unwrap(x, (prev) => prev)` when the consumer only wants
"last value while loading" (the common reason people reached for `useRecoilValueLoadable`).

## 7. Callbacks, snapshots and refreshers

`useRecoilCallback` gives a snapshot of the whole graph; `useAtomCallback` gives `get`/`set` on
the live store. For a migration they are equivalent: `snapshot.getPromise(asyncAtom)` becomes
`await get(asyncAtom)` because reading an async atom in a write function returns its promise.
Keep the dependency array as the `useCallback` deps.

`useRecoilRefresher_UNSTABLE(sel)` re-runs one selector. Define the atom with
`atomWithRefresh(read)` and call its setter with no arguments. If several consumers refresh the
same atom, or the atom must stay a plain primitive, read a counter atom inside the read function
and bump it. Note that `refresh(sel)` inside a callback becomes `set(sel)`, which type-checks
only for an `atomWithRefresh` atom.

`snapshot_UNSTABLE` in tests becomes `createStore()` (§ 9).

## 8. Cache semantics

A Recoil selector memoises its result per dependency-value tuple (LRU, up to
`cachePolicy_UNSTABLE.maxSize`). Toggling an input back to a previous value returns instantly
from cache, and for async selectors skips the network. A Jotai derived atom keeps only the
current value: toggling re-runs the read and, if it fetches, re-fetches. Concurrent reads of the
same atom still share one promise, so there is no duplicate request within one state.

Most selectors do not care. For expensive fetches driven by filter inputs, decide explicitly:
`atomWithCache` from `jotai-cache` (LRU by dependency values, the closest equivalent), or move
server data to `jotai-tanstack-query` and keep Jotai for client state. Dropping
`cachePolicy_UNSTABLE` without this check is where "the page got slower" reports come from.

## 9. Tests

```ts
const store = createStore();
store.set(counterAtom, 21);
expect(store.get(doubleAtom)).toBe(42);
expect(await store.get(userPostsAtom)).toHaveLength(3);
store.set(tempFahrenheitAtom, RESET);
```

React tests wrap the tree in `<Provider store={store}>` and set atoms on the store before
rendering; `initializeState` has no test-only equivalent and needs none.

Two traps found in real code bases:

- A Jest `moduleNameMapper` such as `'^recoil/(.*)$': '<rootDir>/recoil/$1'` (a project folder
  named `recoil`) shadows the package's subpaths and will shadow `jotai/*` if the folder is renamed
  carelessly. Rename the state folder (`state/`), then delete the alias with the package.
- Jotai 3 is ESM-only. Jest with the default `transformIgnorePatterns` fails to parse it; allow
  `node_modules/(jotai|jotai-.*)` to be transformed, or run the state tests under Vitest.

## 10. Finishing

The last wave removes `RecoilRoot`, `initializeState` (now `useHydrateAtoms`), every bridge, the
`recoil` dependency, `RecoilEnv` tweaks, the Jest alias, and the `recoil`-named folders. Then run
`inventory.mjs <src> --check`: it exits non-zero while any file still imports `recoil`. Only then
is React 19 unblocked (Recoil is archived and never gained React 19 support).
