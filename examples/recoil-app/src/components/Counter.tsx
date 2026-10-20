import { RecoilState, useRecoilState, useRecoilValue, useResetRecoilState } from 'recoil';
import { counterAtom } from '../state/atoms';
import { doubleSelector } from '../state/selectors';

/** Helper typed against Recoil's state type (type-mapping case). */
function useNumberState(state: RecoilState<number>) {
  const [value, setValue] = useRecoilState(state);
  return { value, increment: () => setValue((v) => v + 1) };
}

export function Counter() {
  const { value, increment } = useNumberState(counterAtom);
  const double = useRecoilValue(doubleSelector);
  const reset = useResetRecoilState(counterAtom);
  return (
    <section>
      <p>
        {value} × 2 = {double}
      </p>
      <button onClick={increment}>+1</button>
      <button onClick={reset}>reset</button>
    </section>
  );
}
