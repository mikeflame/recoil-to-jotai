import { useState } from 'react';
import { useRecoilValueLoadable } from 'recoil';
import { searchResultsFamily } from '../state/selectors';

/** The family is called with a fresh object literal on every render. */
export function Search() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const results = useRecoilValueLoadable(searchResultsFamily({ q, page }));
  return (
    <section>
      <input value={q} onChange={(e) => setQ(e.target.value)} />
      <button onClick={() => setPage((p) => p + 1)}>next page</button>
      {results.state === 'hasValue' && <p>{results.contents.total} hits</p>}
    </section>
  );
}
