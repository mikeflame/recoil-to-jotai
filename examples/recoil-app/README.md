# recoil-app — the migration kata

A deliberately small Recoil app (17 features, 9 components, 5 tests) that plants every case a
Recoil → Jotai migration has to get right:

| Case | Where |
| --- | --- |
| plain atom, derived selector, reset | `state/atoms.ts` `counterAtom`, `state/selectors.ts` `doubleSelector`, `components/Counter.tsx` |
| atom hydrated through `RecoilRoot initializeState` | `userAtom`, `components/App.tsx` |
| atom effect: localStorage with validation and `DefaultValue` fallback | `themeAtom`, `state/effects.ts` |
| `atomFamily` with a parameterised default | `todoFamily` |
| atom whose default is a selector (resettable to derived) | `settingsAtom` |
| `atomFamily` whose default is an async `selectorFamily` | `postsCountFamily` |
| async selector with `cachePolicy_UNSTABLE` and a refresh trigger | `userPostsSelector` |
| `selectorFamily` keyed by an object, called with a literal in render | `searchResultsFamily`, `components/Search.tsx` |
| `waitForAll`, `noWait` | `dashboardSelector`, `postsPreviewSelector` |
| writable selector with `DefaultValue` reset | `tempFahrenheitSelector`, `components/Thermostat.tsx` |
| `useRecoilValueLoadable`, `Loadable` prop type, `valueMaybe()`, `.contents` | `components/Posts.tsx` |
| `useRecoilStateLoadable` | `components/Settings.tsx` |
| `useRecoilRefresher_UNSTABLE` | `components/Posts.tsx` |
| `useRecoilCallback` with `snapshot.getPromise`, `set`, `reset`, `refresh` | `components/TodoList.tsx` |
| `RecoilState<T>` helper typing | `components/Counter.tsx` |
| `snapshot_UNSTABLE` tests | `state/selectors.test.ts` |

`npm install && npm run check` must pass before and after a migration (`tsc --noEmit` + Vitest).
`jotai`, `jotai-family`, `jotai-loadable` and `fast-deep-equal` are preinstalled so the migration
can run offline. The skill's own test (`skills/recoil-to-jotai/scripts/inventory.test.mjs`) asserts
the inventory finds every row of this table.
