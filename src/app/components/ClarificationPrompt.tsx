type Props = { question: string; options: string[]; name?: string; onSelect?: (option: string) => void };
export function ClarificationPrompt({ question, options, name = 'shopping-priority', onSelect }: Props) {
  const titleId = `clarification-${name}`;
  return <section className="clarification" aria-labelledby={titleId}><p className="intent__status">A little more detail would help</p><h2 id={titleId}>{question}</h2><fieldset className="clarification__options"><legend className="visually-hidden">Clarification choices</legend>{options.map((option) => <label key={option}><input type="radio" name={name} value={option} onChange={() => onSelect?.(option)} /> <span>{option}</span></label>)}</fieldset></section>;
}
