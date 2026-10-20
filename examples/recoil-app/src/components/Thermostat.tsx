import { useRecoilState, useResetRecoilState } from 'recoil';
import { tempFahrenheitSelector } from '../state/selectors';

/** Reads and writes through a writable selector; reset goes through DefaultValue. */
export function Thermostat() {
  const [fahrenheit, setFahrenheit] = useRecoilState(tempFahrenheitSelector);
  const reset = useResetRecoilState(tempFahrenheitSelector);
  return (
    <section>
      <input type="number" value={fahrenheit} onChange={(e) => setFahrenheit(Number(e.target.value))} />
      <button onClick={reset}>reset</button>
    </section>
  );
}
