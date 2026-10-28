import type { ReactNode } from 'react';

type Props = {
  title: string;
  summary: string;
  status: 'loading' | 'completed' | 'empty' | 'failed';
  grouped: boolean;
  locale?: 'en' | 'he';
  children: ReactNode;
};

const labels: Record<Props['status'], string> = {
  loading: 'Searching',
  completed: 'Options for this goal',
  empty: 'No matching options',
  failed: 'I couldn’t finish this search',
};

export function IntentSection({ title, summary, status, grouped, locale = 'en', children }: Props) {
  const id = `intent-${title.replaceAll(' ', '-').toLowerCase()}`;
  const hebrewLabels: typeof labels = { loading: 'מחפש', completed: 'אפשרויות לבקשה הזאת', empty: 'לא נמצאו אפשרויות מתאימות', failed: 'לא הצלחתי להשלים את החיפוש' };
  return <section className={`intent ${grouped ? 'intent--grouped' : 'intent--single'}`} aria-labelledby={id}>
    <header className="intent__header">
      <p className="intent__status">{(locale === 'he' ? hebrewLabels : labels)[status]}</p>
      <h2 id={id}>{title}</h2>
      <p>{summary}</p>
    </header>
    {children}
  </section>;
}
