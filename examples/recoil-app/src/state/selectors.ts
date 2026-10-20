import { DefaultValue, noWait, selector, selectorFamily, waitForAll } from 'recoil';
import { api } from '../api';
import type { Post, SearchParams, SearchResult } from '../types';
import {
  counterAtom,
  refreshTickAtom,
  settingsAtom,
  tempCelsiusAtom,
  todoFamily,
  todoIdsAtom,
  userAtom,
} from './atoms';

/** Sync derived value. */
export const doubleSelector = selector<number>({
  key: 'double',
  get: ({ get }) => get(counterAtom) * 2,
});

export const userNameSelector = selector<string>({
  key: 'userName',
  get: ({ get }) => get(userAtom)?.name ?? 'guest',
});

/** Reads family members dynamically. */
export const todoStatsSelector = selector<{ total: number; done: number }>({
  key: 'todoStats',
  get: ({ get }) => {
    const todos = get(todoIdsAtom).map((id) => get(todoFamily(id)));
    return { total: todos.length, done: todos.filter((t) => t.done).length };
  },
});

/** Async selector with a cache policy; depends on a refresh tick so it can be re-fetched. */
export const userPostsSelector = selector<Post[]>({
  key: 'userPosts',
  cachePolicy_UNSTABLE: { eviction: 'most-recent' },
  get: async ({ get }) => {
    get(refreshTickAtom);
    const user = get(userAtom);
    if (!user) {
      return [];
    }
    return api.fetchPosts(user.id);
  },
});

/** selectorFamily keyed by an OBJECT parameter (Recoil compares params by value). */
export const searchResultsFamily = selectorFamily<SearchResult, SearchParams>({
  key: 'searchResults',
  get:
    (params) =>
    async ({ get }) => {
      const user = get(userAtom);
      return api.search({ ...params, userId: user?.id });
    },
});

/** waitForAll over an async selector and a sync atom. */
export const dashboardSelector = selector<{ visible: Post[] }>({
  key: 'dashboard',
  get: ({ get }) => {
    const [posts, settings] = get(waitForAll([userPostsSelector, settingsAtom]));
    return { visible: posts.slice(0, settings.pageSize) };
  },
});

/** noWait: read an async selector without suspending. */
export const postsPreviewSelector = selector<string>({
  key: 'postsPreview',
  get: ({ get }) => {
    const loadable = get(noWait(userPostsSelector));
    return loadable.state === 'hasValue' ? `${loadable.contents.length} posts` : 'loading…';
  },
});

/** Writable selector with reset support through DefaultValue. */
export const tempFahrenheitSelector = selector<number>({
  key: 'tempFahrenheit',
  get: ({ get }) => (get(tempCelsiusAtom) * 9) / 5 + 32,
  set: ({ set, reset }, value) => {
    if (value instanceof DefaultValue) {
      reset(tempCelsiusAtom);
      return;
    }
    set(tempCelsiusAtom, ((value - 32) * 5) / 9);
  },
});
