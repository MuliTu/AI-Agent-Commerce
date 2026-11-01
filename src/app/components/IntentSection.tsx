import type { ReactNode } from 'react';

type Props = {
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

export function IntentSection({ summary, status, grouped, locale = 'en', children }: Props) {
  const hebrewLabels: typeof labels = { loading: 'מחפש', completed: 'אפשרויות לבקשה הזאת', empty: 'לא נמצאו אפשרויות מתאימות', failed: 'לא הצלחתי להשלים את החיפוש' };
  const statusLabel = (locale === 'he' ? hebrewLabels : labels)[status];
  return <section className={`intent ${grouped ? 'intent--grouped' : 'intent--single'}`} aria-label={statusLabel}>
    <header className="intent__header">
      <p className="intent__status">{statusLabel}</p>
      <p>{summary}</p>
    </header>
    {children}
  </section>;
}
