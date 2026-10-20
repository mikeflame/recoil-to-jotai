# Recoil → Jotai API map

Every mapping below is for the native rewrite. "v2" means Jotai 2.6+ (`jotai/utils` still ships
`atomFamily` and `loadable`); "v3" means Jotai 3.x (`atomFamily` moved to `jotai-family`,
`loadable` was removed, `setSelf` is gone, ESM-only). Check the installed version first — the
inventory prints it — and import from the right place. When a row says "decide", there is no
mechanical equivalent; read `hard-cases.md` for the options.

## Definitions

| Recoil | Jotai | Notes |
| --- | --- | --- |
| `atom({ key, default: v })` | `atom(v)` | No key. Type: `PrimitiveAtom<T>`. |
| `atom({ key, default: someSelector })` | `atomWithDefault((get) => get(someAtom))` | Follows the derived value until written; `RESET` returns it to following. |
| `atom({ key, default: promise })` | `atom(promise)` or `atomWithDefault(async (get) => …)` | Reads suspend until resolved. |
| `atom({ …, effects: [storageEffect] })` | `atomWithStorage(key, initial, storage?, { getOnInit })` | See `hard-cases.md` § Persistence for validation, reset and storage-layout compatibility. |
| `atom({ …, effects: [otherEffect] })` | `atom.onMount = (setAtom) => { …; return cleanup }` or `jotai-effect` | `setSelf` → `setAtom`; `onSet` → a write wrapper atom or an `atomEffect`. |
| `selector({ key, get })` | `atom((get) => …)` | Read-only derived atom. `Atom<T>`. |
| `selector({ key, get: async ({ get }) => … })` | `atom(async (get) => …)` | Readers suspend; wrap with `loadable`/`unwrap` for non-suspending reads. |
| `selector({ get: () => { if (typeof window === 'undefined') return X; return fetch() } })` (a sync read that may return a promise) | `atom((get): T \| Promise<T> => { … })` — keep the read **synchronous** | A Jotai read may return a promise. Marking the function `async` would turn the guard's `X` into a pending promise and change the server-rendered markup from data to loading. |
| `selector({ key, get, set })` | `atom(read, (get, set, value) => …)` | `value` may be `RESET` if anyone resets it: type it `T \| typeof RESET` and handle it. |
| `cachePolicy_UNSTABLE: {…}` | (drop) | Jotai memoises only the current dependency values; see `hard-cases.md` § Cache semantics. |
| `dangerouslyAllowMutability: true` | (drop) | Jotai never freezes values (`freezeAtom` exists for the opposite). |
| `atomFamily({ key, default: v })` | v2 `atomFamily((p) => atom(v))` from `jotai/utils`; v3 from `jotai-family` | Pass `areEqual` for non-primitive params; plan eviction. |
| `atomFamily({ key, default: (p) => v(p) })` | `atomFamily((p) => atom(v(p)))` | |
| `atomFamily({ key, default: selectorFamily(…) })` | `atomFamily((p) => atomWithDefault((get) => derived(get, p)))` | Resettable to the derived value, like Recoil. |
| `selectorFamily({ key, get: (p) => ({ get }) => … })` | `atomFamily((p) => atom((get) => …))` | Same `areEqual`/eviction concerns. |
| `selectorFamily({ …, set: (p) => ({ set }, v) => … })` | `atomFamily((p) => atom(read, (get, set, v) => …))` | |
| `constSelector(v)` | `atom(v)` | |
| `errorSelector(msg)` | `atom(() => { throw new Error(msg) })` | |

## Hooks

| Recoil | Jotai | Notes |
| --- | --- | --- |
| `useRecoilState(a)` | `useAtom(a)` | |
| `useRecoilValue(a)` | `useAtomValue(a)` | Suspends on async atoms, like Recoil. |
| `useSetRecoilState(a)` | `useSetAtom(a)` | Does not subscribe (same as Recoil). |
| `useResetRecoilState(a)` | `useResetAtom(a)` | `a` must accept `RESET`: `atomWithReset`, `atomWithDefault`, `atomWithStorage`, or a write that handles `RESET`. |
| `useRecoilValueLoadable(a)` | v2 `useAtomValue(loadableA)` with `const loadableA = loadable(a)` at module level; v3 `jotai-loadable` or the userland `loadable` from the v3 guide | Never call `loadable(a)` inside render: a new atom per render loses identity and re-suspends. |
| `useRecoilStateLoadable(a)` | `[useAtomValue(loadableA), useSetAtom(a)]` | |
| `useRecoilRefresher_UNSTABLE(sel)` | Define `sel = atomWithRefresh(read)`; `const refresh = useSetAtom(sel); refresh()` | Always call the setter with **no argument**: `onClick={refresh}` passes the event and throws in development. A `loadable()` of the atom reports `loading` during the refetch; use `unwrap(sel, (prev) => prev)` when the previous value must stay on screen. |
| refresh-counter idiom: `tickAtom = atom({ default: 0 })` read by a selector only as `get(tickAtom)` with the value unused, bumped by consumers with `useSetRecoilState(tickAtom)((n) => n + 1)` | fold both into **one** `atomWithRefresh(read)`; consumers `useSetAtom(a)()` | Two Recoil features become one atom (the inventory flags the counter as `refresh-counter`). The one-argument overload types it `WritableAtom<Value, [], void>`, so any other `set(a, value)` is a type error. |
| `useRecoilCallback(({ snapshot, set, reset, refresh }) => (...args) => …, deps)` | `useAtomCallback(useCallback((get, set, ...args) => …, deps))` | `snapshot.getPromise(x)` → `await get(x)`; `snapshot.getLoadable(x).getValue()` → `get(x)`; `reset(x)` → `set(x, RESET)`; `refresh(sel)` → `set(sel)` on an `atomWithRefresh`; `snapshot.retain()` → delete. |
| `useRecoilSnapshot()` / `useGotoRecoilSnapshot()` | decide | Undo/redo → `jotai-history`; debugging → `jotai-devtools`. |
| `useRecoilTransaction_UNSTABLE(({ get, set }) => …)` | write-only atom `atom(null, (get, set, ...args) => …)` | Jotai applies all writes of one write function before notifying subscribers. |
| `useRecoilTransactionObserver_UNSTABLE` | `store.sub(a, cb)` per atom, or `jotai-devtools` | |
| `useRecoilBridgeAcrossReactRoots_UNSTABLE()` | `const store = useStore()` in root A, `<Provider store={store}>` in root B | |
| `useRecoilStoreID()` | compare the `Store` object | |

## Root and SSR

| Recoil | Jotai | Notes |
| --- | --- | --- |
| `<RecoilRoot>` | `<Provider>` (own store) or provider-less (one global store) | Provider-less mode shares one store across every request on a server: never on SSR. |
| `<RecoilRoot initializeState={({ set }) => set(a, v)}>` | `useHydrateAtoms([[a, v]])` in a component rendered inside the Provider | Hydrates once per store (first render, also during SSR). Writable derived atoms are hydrated through their write. Later prop changes need an effect that calls `useSetAtom`. |
| `<RecoilRoot override={false}>` (share the parent's state) | `<Provider store={parentStore}>` | |
| `RecoilEnv.RECOIL_DUPLICATE_ATOM_KEY_CHECKING_ENABLED` | (delete) | No keys, no duplicate-key warnings. |

## Async utilities

| Recoil | Jotai | Notes |
| --- | --- | --- |
| `get(waitForAll([a, b]))` | sync deps: `[get(a), get(b)]`; async deps: `await Promise.all([get(a), get(b)])` inside `atom(async (get) => …)` | `get(asyncAtom)` returns the promise. |
| `get(waitForAny([a, b]))` | `await Promise.race([...])` or per-atom `loadable` | decide per use. |
| `get(waitForNone([a, b]))` | `[get(loadableA), get(loadableB)]` | |
| `get(waitForAllSettled([a, b]))` | `await Promise.allSettled([...])` or per-atom `loadable` | |
| `get(noWait(a))` | v2 `get(loadableA)`; v3 `get(unwrap(a, () => undefined))` when only the value matters | Create the wrapper atom at module level. |
| `Loadable` shape `{ state: 'hasValue' \| 'loading' \| 'hasError', contents }` + methods | `{ state: 'hasData', data } \| { state: 'loading' } \| { state: 'hasError', error }` | `'hasValue'` → `'hasData'`; `.contents` under `'hasValue'` → `.data`, under `'hasError'` → `.error`; `valueMaybe()` → `l.state === 'hasData' ? l.data : undefined`; `errorMaybe()` → `l.state === 'hasError' ? l.error : undefined`; `getValue()`/`valueOrThrow()` → read the atom directly (suspends/throws); `toPromise()` → `store.get(asyncAtom)`. |
| "keep the previous value while reloading" | `unwrap(a, (prev) => prev)` | A frequent hand-rolled Recoil helper; Jotai has it built in. |
| `RecoilLoadable.of(v)` / `RecoilLoadable.loading()` / `RecoilLoadable.error(e)` (hand-built loadables passed as props) | `{ state: 'hasData', data: v }` / `{ state: 'loading' }` / `{ state: 'hasError', error: e }` | Plain objects typed as Jotai's `Loadable<T>`; no class, no methods. |
| `RecoilLoadable.all([...])` | `Promise.all` in an async atom, or per-item loadables | |

## Reset and defaults

| Recoil | Jotai | Notes |
| --- | --- | --- |
| `new DefaultValue()` returned from an effect/validator | return the atom's initial value, or `RESET` when writing | |
| `value instanceof DefaultValue` inside a selector `set` | `value === RESET` | `import { RESET } from 'jotai/utils'`. |
| `reset(atom)` in `useRecoilCallback` | `set(atom, RESET)` | Only for atoms that accept `RESET`. |

## Types

| Recoil | Jotai | Notes |
| --- | --- | --- |
| `RecoilState<T>` | `PrimitiveAtom<T>` (or `WritableAtom<T, [SetStateAction<T>], void>`) | |
| `RecoilValue<T>`, `RecoilValueReadOnly<T>` | `Atom<T>` | |
| `SetterOrUpdater<T>` | `(update: SetStateAction<T>) => void` (`SetStateAction` is exported by `jotai`) | |
| `Loadable<T>` | v2 `import type { Loadable } from 'jotai/vanilla/utils/loadable'`; v3 from `jotai-loadable` or a local type | |
| `AtomEffect<T>` | none; `onMount: (setAtom) => void \| (() => void)` | |
| `Snapshot`, `CallbackInterface` | `Getter`/`Setter` (or the `Store`) | |
| `GetRecoilValue`, `SetRecoilState`, `ResetRecoilState` | `Getter`, `Setter`, `Setter` with `RESET` | |

## Testing

| Recoil | Jotai | Notes |
| --- | --- | --- |
| `snapshot_UNSTABLE(({ set }) => set(a, v))` | `const store = createStore(); store.set(a, v)` | |
| `snapshot.getLoadable(sel).valueOrThrow()` | `store.get(sel)` | Async: `await store.get(asyncAtom)`. |
| `snapshot.getPromise(asyncSel)` | `await store.get(asyncSel)` | |
| `snapshot.map(({ reset }) => reset(a))` | `store.set(a, RESET)` | |
| `<RecoilRoot initializeState>` in render tests | `<Provider store={store}>` with `store.set` before render, or `useHydrateAtoms` | |
| `jest.mock('recoil', …)` | usually unnecessary: build a fresh `createStore()` per test | Jest + Jotai 3 (ESM-only) needs `transformIgnorePatterns` to let `node_modules/jotai` be transformed, or a Vitest runner. |

## Tooling

| Recoil | Jotai | Notes |
| --- | --- | --- |
| Recoil DevTools / `key` names in devtools | `jotai-devtools` + `atom.debugLabel = 'name'` | `jotai/babel` (v2) / `jotai-babel` (v3) or the SWC plugin set labels and keep atoms stable under React Refresh. |
| `recoil-persist` | `atomWithStorage` + a storage adapter that keeps the old blob layout, or a one-time migration | See `hard-cases.md` § Persistence. |
| `recoil-sync` / `recoil-relay` | `jotai-location` / `jotai-relay` or hand-written `onMount` sync | decide. |
