type Props = { role: 'user' | 'assistant'; children: string };
export function ConversationMessage({ role, children }: Props) {
  const speaker = role === 'user' ? 'You' : 'Bazak';
  return <article className={`message message--${role}`} aria-label={`${speaker} message`}><p className="message__speaker">{speaker}</p><div className="message__content">{children}</div></article>;
}
