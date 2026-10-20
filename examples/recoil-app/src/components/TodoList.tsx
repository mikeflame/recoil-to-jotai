import { useRecoilCallback, useRecoilValue } from 'recoil';
import { todoFamily, todoIdsAtom } from '../state/atoms';
import { todoStatsSelector, userPostsSelector } from '../state/selectors';

export function TodoList() {
  const stats = useRecoilValue(todoStatsSelector);

  /** Snapshot read + multiple writes in one callback. */
  const addTodo = useRecoilCallback(
    ({ snapshot, set }) =>
      async (title: string) => {
        const ids = await snapshot.getPromise(todoIdsAtom);
        const id = (ids[ids.length - 1] ?? 0) + 1;
        set(todoFamily(id), { id, title, done: false });
        set(todoIdsAtom, [...ids, id]);
      },
    [],
  );

  /** reset + refresh from a callback. */
  const clearAll = useRecoilCallback(
    ({ snapshot, reset, refresh }) =>
      async () => {
        const ids = await snapshot.getPromise(todoIdsAtom);
        ids.forEach((id) => reset(todoFamily(id)));
        reset(todoIdsAtom);
        refresh(userPostsSelector);
      },
    [],
  );

  return (
    <section>
      <p>
        {stats.done}/{stats.total} done
      </p>
      <button onClick={() => addTodo('new todo')}>add</button>
      <button onClick={clearAll}>clear</button>
    </section>
  );
}
