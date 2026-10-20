import { atom, atomFamily, DefaultValue, selector, selectorFamily } from 'recoil';
import { api } from '../api';
import type { Settings, Theme, Todo, User } from '../types';
import { localStorageEffect } from './effects';

/** Plain primitive atom. */
export const counterAtom = atom<number>({ key: 'counter', default: 0 });

/** Hydrated from server props through RecoilRoot initializeState (see App.tsx). */
export const userAtom = atom<User | null>({ key: 'user', default: null });

/** Persisted atom: effect + validation + DefaultValue fallback. */
export const themeAtom = atom<Theme>({
  key: 'theme',
  default: 'light',
  effects: [
    localStorageEffect<Theme>({
      key: 'app_theme',
      validate: (raw) => (raw === 'light' || raw === 'dark' ? raw : new DefaultValue()),
    }),
  ],
});

export const todoIdsAtom = atom<number[]>({ key: 'todoIds', default: [] });

/** atomFamily with a parameterised default. */
export const todoFamily = atomFamily<Todo, number>({
  key: 'todo',
  default: (id) => ({ id, title: '', done: false }),
});

/** Atom whose default is derived: follows the selector until set, reset returns to following it. */
export const settingsAtom = atom<Settings>({
  key: 'settings',
  default: selector<Settings>({
    key: 'settings/default',
    get: ({ get }) => ({ pageSize: get(userAtom)?.isAdmin ? 50 : 10 }),
  }),
});

/** atomFamily whose default is an async selectorFamily (nested definition). */
export const postsCountFamily = atomFamily<number, number>({
  key: 'postsCount',
  default: selectorFamily<number, number>({
    key: 'postsCount/default',
    get: (userId) => async () => (await api.fetchPosts(userId)).length,
  }),
});

export const tempCelsiusAtom = atom<number>({ key: 'tempCelsius', default: 20 });

/** Manual refresh trigger read by userPostsSelector. */
export const refreshTickAtom = atom<number>({ key: 'refreshTick', default: 0 });
