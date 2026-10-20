import { AtomEffect, DefaultValue } from 'recoil';

type PersistOptions<T> = {
  key: string;
  // Returning DefaultValue falls back to the atom default when stored data is stale/invalid.
  validate: (raw: unknown) => T | DefaultValue;
};

/** Persist an atom to localStorage; a reset removes the stored entry. */
export const localStorageEffect =
  <T>({ key, validate }: PersistOptions<T>): AtomEffect<T> =>
  ({ setSelf, onSet }) => {
    if (typeof window === 'undefined') {
      return;
    }
    const saved = window.localStorage.getItem(key);
    if (saved != null) {
      try {
        setSelf(validate(JSON.parse(saved)));
      } catch {
        // ignore corrupt entries
      }
    }
    onSet((newValue, _oldValue, isReset) => {
      if (isReset) {
        window.localStorage.removeItem(key);
      } else {
        window.localStorage.setItem(key, JSON.stringify(newValue));
      }
    });
  };
