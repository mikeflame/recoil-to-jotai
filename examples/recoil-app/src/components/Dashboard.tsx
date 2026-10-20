import { useRecoilValue } from 'recoil';
import { postsCountFamily, userAtom } from '../state/atoms';
import { dashboardSelector } from '../state/selectors';

/** Suspends on the async selector; reads a family member keyed by the user id. */
export function Dashboard() {
  const user = useRecoilValue(userAtom);
  const { visible } = useRecoilValue(dashboardSelector);
  const postsCount = useRecoilValue(postsCountFamily(user?.id ?? 0));
  return (
    <section>
      <p>
        showing {visible.length} of {postsCount}
      </p>
    </section>
  );
}
