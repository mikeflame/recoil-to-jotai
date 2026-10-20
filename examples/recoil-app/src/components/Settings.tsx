import { useRecoilStateLoadable } from 'recoil';
import { settingsAtom } from '../state/atoms';

export function Settings() {
  const [settings, setSettings] = useRecoilStateLoadable(settingsAtom);
  if (settings.state !== 'hasValue') {
    return null;
  }
  return (
    <section>
      <label>
        page size
        <input
          type="number"
          value={settings.contents.pageSize}
          onChange={(e) => setSettings({ pageSize: Number(e.target.value) })}
        />
      </label>
    </section>
  );
}
