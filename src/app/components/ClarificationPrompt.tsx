type Props = { question: string; options: string[] };
export function ClarificationPrompt({ question, options }: Props) {
  return <section className="clarification" aria-labelledby="clarification-title"><p className="intent__status">A little more detail would help</p><h2 id="clarification-title">{question}</h2><fieldset className="clarification__options"><legend className="visually-hidden">Clarification choices</legend>{options.map((option) => <label key={option}><input type="radio" name="laptop-priority" value={option} /> <span>{option}</span></label>)}</fieldset></section>;
}
