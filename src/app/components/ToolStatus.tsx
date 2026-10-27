type Props = { state: 'loading' | 'success' | 'failure'; label: string; detail: string };
export function ToolStatus({ state, label, detail }: Props) {
  return <div className={`tool-status tool-status--${state}`} role="status" aria-live={state === 'loading' ? 'polite' : 'off'}><span className="tool-status__indicator" aria-hidden="true" /><div><p>{label}</p><span>{detail}</span></div></div>;
}
