export type User = { id: number; name: string; isAdmin: boolean };
export type Post = { id: number; userId: number; title: string };
export type Todo = { id: number; title: string; done: boolean };
export type Settings = { pageSize: number };
export type SearchParams = { q: string; page: number };
export type SearchResult = { hits: string[]; page: number; total: number };
export type Theme = 'light' | 'dark';
