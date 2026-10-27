type Props = { question: string; options: string[]; name?: string; empty?: boolean; onSelect?: (option: string) => void };
export function ClarificationPrompt({ question, options, name = 'shopping-priority', empty = false, onSelect }: Props) {
  const titleId = `clarification-${name}`;
  return <section className="clarification" aria-labelledby={titleId}>{empty && <div className="recommendation-state recommendation-state--empty" role="status" aria-live="polite"><p>No catalog matches yet</p><span>The current request returned no trusted products. Choose one focused change to continue.</span></div>}<p className="intent__status">A little more detail would help</p><h2 id={titleId}>{question}</h2><fieldset className="clarification__options"><legend className="visually-hidden">Clarification choices</legend>{options.map((option) => <label key={option}><input type="radio" name={name} value={option} onChange={() => onSelect?.(option)} /> <span>{option}</span></label>)}</fieldset></section>;
}
