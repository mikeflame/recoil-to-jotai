import type { Post, SearchParams, SearchResult } from './types';

// Deterministic in-memory "backend": no network, so tests and migrations can run offline.
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 1));

export const api = {
  async fetchPosts(userId: number): Promise<Post[]> {
    await tick();
    return [1, 2, 3].map((n) => ({ id: userId * 10 + n, userId, title: `Post ${n} of user ${userId}` }));
  },
  async search(params: SearchParams & { userId?: number }): Promise<SearchResult> {
    await tick();
    const hits = params.q ? [`${params.q}-a`, `${params.q}-b`] : [];
    return { hits, page: params.page, total: hits.length };
  },
};
