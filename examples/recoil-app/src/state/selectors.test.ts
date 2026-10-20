import { snapshot_UNSTABLE } from 'recoil';
import { describe, expect, it } from 'vitest';
import { counterAtom, tempCelsiusAtom, todoFamily, todoIdsAtom, userAtom } from './atoms';
import {
  doubleSelector,
  tempFahrenheitSelector,
  todoStatsSelector,
  userNameSelector,
  userPostsSelector,
} from './selectors';

describe('selectors', () => {
  it('derives double from counter', () => {
    const snapshot = snapshot_UNSTABLE(({ set }) => set(counterAtom, 21));
    expect(snapshot.getLoadable(doubleSelector).valueOrThrow()).toBe(42);
  });

  it('falls back to guest without a user', () => {
    const snapshot = snapshot_UNSTABLE();
    expect(snapshot.getLoadable(userNameSelector).valueOrThrow()).toBe('guest');
  });

  it('writes through the fahrenheit selector and resets to the default', () => {
    const hot = snapshot_UNSTABLE(({ set }) => set(tempFahrenheitSelector, 212));
    expect(hot.getLoadable(tempCelsiusAtom).valueOrThrow()).toBe(100);

    const reset = hot.map(({ reset }) => reset(tempFahrenheitSelector));
    expect(reset.getLoadable(tempCelsiusAtom).valueOrThrow()).toBe(20);
  });

  it('counts todos across family members', () => {
    const snapshot = snapshot_UNSTABLE(({ set }) => {
      set(todoIdsAtom, [1, 2]);
      set(todoFamily(1), { id: 1, title: 'a', done: true });
      set(todoFamily(2), { id: 2, title: 'b', done: false });
    });
    expect(snapshot.getLoadable(todoStatsSelector).valueOrThrow()).toEqual({ total: 2, done: 1 });
  });

  it('fetches posts for the current user', async () => {
    const snapshot = snapshot_UNSTABLE(({ set }) =>
      set(userAtom, { id: 7, name: 'Ada', isAdmin: false }),
    );
    snapshot.retain();
    const posts = await snapshot.getPromise(userPostsSelector);
    expect(posts).toHaveLength(3);
    expect(posts[0].userId).toBe(7);
  });
});
