import { useRecoilState, useResetRecoilState } from 'recoil';
import { themeAtom } from '../state/atoms';

export function ThemeToggle() {
  const [theme, setTheme] = useRecoilState(themeAtom);
  const resetTheme = useResetRecoilState(themeAtom);
  return (
    <section>
      <button onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme}</button>
      <button onClick={resetTheme}>system default</button>
    </section>
  );
}
