import type { ReactNode } from 'react';
type Props = { title: string; summary: string; status: 'loading' | 'completed' | 'empty' | 'failed'; children: ReactNode };
const labels: Record<Props['status'], string> = { loading: 'Searching', completed: 'Results ready', empty: 'No matches', failed: 'Search failed' };
export function IntentSection({ title, summary, status, children }: Props) {
  const id = `intent-${title.replaceAll(' ', '-').toLowerCase()}`;
  return <section className="intent" aria-labelledby={id}><header className="intent__header"><div><p className="intent__status">{labels[status]}</p><h2 id={id}>{title}</h2></div><p>{summary}</p></header>{children}</section>;
}
