import { Suspense } from 'react';
import { RecoilRoot } from 'recoil';
import { userAtom } from '../state/atoms';
import type { User } from '../types';
import { Counter } from './Counter';
import { Dashboard } from './Dashboard';
import { Posts } from './Posts';
import { Search } from './Search';
import { Settings } from './Settings';
import { ThemeToggle } from './ThemeToggle';
import { Thermostat } from './Thermostat';
import { TodoList } from './TodoList';

type AppProps = { user: User | null };

/** The server-rendered user lands in state through initializeState (runs once per root). */
export function App({ user }: AppProps) {
  return (
    <RecoilRoot
      initializeState={({ set }) => {
        set(userAtom, user);
      }}
    >
      <Counter />
      <ThemeToggle />
      <Thermostat />
      <Settings />
      <TodoList />
      <Suspense fallback={<p>Loading…</p>}>
        <Posts />
        <Dashboard />
        <Search />
      </Suspense>
    </RecoilRoot>
  );
}
