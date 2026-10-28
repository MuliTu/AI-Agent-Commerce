import type { ReactNode } from 'react';

type Props = { role: 'user' | 'assistant'; children: ReactNode; locale?: 'en' | 'he' };
export function ConversationMessage({ role, children, locale = 'en' }: Props) {
  const speaker = role === 'user' ? (locale === 'he' ? 'אתה' : 'You') : 'Bazak';
  return <article className={`message message--${role}`} aria-label={`${speaker} message`}><p className="message__speaker">{speaker}</p><div className="message__content">{children}</div></article>;
}
