import { Loadable, useRecoilRefresher_UNSTABLE, useRecoilValue, useRecoilValueLoadable } from 'recoil';
import { postsPreviewSelector, userPostsSelector } from '../state/selectors';
import type { Post } from '../types';

/** Receives a Recoil Loadable as a prop (type-mapping + method idioms). */
function PostList({ posts }: { posts: Loadable<Post[]> }) {
  const count = posts.valueMaybe()?.length ?? 0;
  if (posts.state === 'loading') {
    return <p>Loading posts…</p>;
  }
  if (posts.state === 'hasError') {
    return <p>Failed: {String(posts.contents)}</p>;
  }
  return (
    <ul data-count={count}>
      {posts.contents.map((post) => (
        <li key={post.id}>{post.title}</li>
      ))}
    </ul>
  );
}

export function Posts() {
  const posts = useRecoilValueLoadable(userPostsSelector);
  const refresh = useRecoilRefresher_UNSTABLE(userPostsSelector);
  const preview = useRecoilValue(postsPreviewSelector);
  return (
    <section>
      <p>{preview}</p>
      <PostList posts={posts} />
      <button onClick={refresh}>refresh</button>
    </section>
  );
}
