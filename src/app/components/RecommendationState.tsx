type Props = { state: 'loading' | 'success' | 'empty' | 'failure'; title: string; description: string };
export function RecommendationState({ state, title, description }: Props) {
  return <div className={`recommendation-state recommendation-state--${state}`} role={state === 'failure' ? 'alert' : 'status'} aria-live={state === 'failure' ? 'assertive' : 'polite'}><p>{title}</p><span>{description}</span></div>;
}
