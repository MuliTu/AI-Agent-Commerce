'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { OrchestrationResult } from '@/lib/orchestration';
import type { ClarificationAnswer } from '@/lib/orchestration/contracts';
import { conversationListSchema, conversationStateSchema, orchestrationResponseSchema, type ConversationState, type ConversationSummary } from '@/lib/orchestration/http';
import { ClarificationPrompt } from './ClarificationPrompt';
import { ConversationMessage } from './ConversationMessage';
import { IntentSection } from './IntentSection';
import { ProductGrid, ProductGridSkeleton } from './ProductGrid';
import { RecommendationState } from './RecommendationState';
import { ToolStatus } from './ToolStatus';
import { recoverAcceptedTurn, type RecoveryReadOutcome } from '@/lib/orchestration/recovery';

type Props = {
  providerEnabled: boolean;
  configurationError?: string;
};

const restoreRetryDelays = [250, 500, 1_000] as const;
const requestTimeoutMs = 30_000;
type RestoreOutcome = RecoveryReadOutcome;
type ConversationEntry = { turnId: string; prompt: string; locale: Locale; result?: OrchestrationResult; failure?: string; completedClarifications?: Record<string, string> };
type Locale = 'en' | 'he';

function localeFor(value: string): Locale {
  return /[\u0590-\u05ff]/u.test(value) ? 'he' : 'en';
}

function clarificationQuestion(field: ClarificationAnswer['field'], question: string, locale: Locale): string {
  if (locale !== 'he') return question;
  if (field === 'category') return 'באיזו קטגוריית מוצרים להתמקד?';
  if (field === 'maxPrice') return 'מה התקציב המרבי שלך?';
  if (field === 'minRating') return 'מה הדירוג המינימלי הרצוי?';
  if (field === 'inStock') return 'להציג רק מוצרים שנמצאים במלאי?';
  return 'איזה פרט נוסף יעזור למקד את החיפוש?';
}

function entriesFromState(state: ConversationState): ConversationEntry[] {
  const entries = state.turns.map((turn) => ({
    turnId: turn.id,
    prompt: state.messages.find(({ turnId, role }) => turnId === turn.id && role === 'user')?.content ?? '',
    locale: localeFor(state.messages.find(({ turnId, role }) => turnId === turn.id && role === 'user')?.content ?? ''),
    ...(turn.result === undefined ? {} : { result: turn.result }),
    ...(turn.failure === undefined ? {} : { failure: turn.failure.message }),
  }));
  return entries.map((entry, index) => {
    const nextPrompt = entries[index + 1]?.prompt ?? '';
    const completedClarifications = Object.fromEntries((entry.result?.outcomes ?? []).flatMap((outcome) => {
      const option = outcome.clarification?.options.find((candidate) => nextPrompt.includes(candidate));
      return option ? [[outcome.intent.id, option]] : [];
    }));
    return Object.keys(completedClarifications).length ? { ...entry, completedClarifications } : entry;
  });
}

function formatConversationDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Saved' : date.toLocaleDateString();
}

type ResultBlocksProps = {
  result: OrchestrationResult;
  actionable: boolean;
  pending: boolean;
  retryingIntentId: string;
  selectedClarification: string;
  completedClarifications?: Record<string, string>;
  onClarification: (intentId: string, goal: string, field: ClarificationAnswer['field'], option: string) => void;
  onRetry: (intentId: string) => void;
  locale: Locale;
};

export function ResultBlocks({ result, actionable, pending, retryingIntentId, selectedClarification, completedClarifications, onClarification, onRetry, locale }: ResultBlocksProps) {
  const grouped = result.outcomes.length > 1;
  const isHebrew = locale === 'he';
  return <div className={`intent-list ${grouped ? 'intent-list--grouped' : 'intent-list--single'}`} aria-label={grouped ? 'Shopping goals' : undefined}>
    {result.outcomes.map((outcome) => {
      if (outcome.intent.status === 'needs_clarification') {
        const clarification = outcome.clarification;
        const completedChoice = completedClarifications?.[outcome.intent.id];
        if (!actionable && completedChoice) {
          return <section className="clarification clarification--completed" aria-label={`Completed clarification for ${outcome.intent.goal}`} key={outcome.intent.id}><p className="intent__status">{isHebrew ? 'ההבהרה הושלמה' : 'Clarification completed'}</p><p><strong>{isHebrew ? 'נבחר:' : 'Selected:'}</strong> {completedChoice}</p></section>;
        }
        if (!clarification) {
          return <IntentSection key={outcome.intent.id} title={outcome.intent.goal} summary={isHebrew ? 'אחזור לבקשה הזאת אחרי התשובה הנוכחית.' : 'I’ll return to this goal after your current answer.'} status="empty" grouped={grouped} locale={locale}><RecommendationState state="empty" title={isHebrew ? 'צריך עוד פרט אחד' : 'I need one more detail'} description={isHebrew ? 'ענו על השאלה הנוכחית ואז אוכל להמשיך עם הבקשה הזאת.' : 'Answer the current question first, then I can continue with this shopping goal.'} /></IntentSection>;
        }
        return <ClarificationPrompt key={outcome.intent.id} name={outcome.intent.id} question={clarificationQuestion(clarification.field, clarification.question, locale)} options={clarification.options} empty={clarification.reason === 'empty'} selected={actionable ? selectedClarification : ''} disabled={!actionable || pending} locale={locale} onSelect={(option) => onClarification(outcome.intent.id, outcome.intent.goal, clarification.field, option)} />;
      }
      if (outcome.intent.status === 'failed') {
        if (outcome.error?.code === 'outside_product_catalog'
          || outcome.error?.code === 'unknown_catalog_category'
          || outcome.error?.code === 'unsupported_constraint') {
          return null;
        }
        const retrying = actionable && retryingIntentId === outcome.intent.id;
        return <IntentSection key={outcome.intent.id} title={outcome.intent.goal} summary={isHebrew ? (grouped ? 'שאר תוצאות החיפוש נשארות זמינות.' : 'שמרתי את הבקשה ללא שינוי כדי שאפשר יהיה לנסות שוב.') : (grouped ? 'Your other shopping goals are still available.' : 'I kept your request unchanged so you can try again.')} status="failed" grouped={grouped} locale={locale}>
          <RecommendationState state={retrying ? 'loading' : 'failure'} title={retrying ? (isHebrew ? 'מחפש שוב' : 'Searching again') : (isHebrew ? 'לא הצלחתי לחפש בקטלוג עבור הבקשה הזאת' : 'I couldn’t search the catalog for this goal')} description={isHebrew ? (retrying && grouped ? 'שאר התוצאות יישארו במקום בזמן החיפוש החוזר.' : retrying ? 'אני מנסה שוב לחפש בקטלוג.' : outcome.error?.message ?? 'לא ניתן היה להשלים את החיפוש בקטלוג.') : (retrying && grouped ? 'The other results will stay in place while I try this search again.' : retrying ? 'I’m trying this catalog search again.' : outcome.error?.message ?? 'The catalog search could not be completed.')} />
          {actionable && outcome.error?.retryable && <button className="secondary-action" type="button" disabled={pending} onClick={() => onRetry(outcome.intent.id)}>{isHebrew ? 'נסה שוב' : 'Try this search again'}</button>}
        </IntentSection>;
      }
      if (outcome.products.length === 0) {
        const category = outcome.intent.constraints.category?.replace(/-/g, ' ');
        const budget = outcome.intent.constraints.maxPrice;
        const filterSummary = category && budget !== undefined
          ? (isHebrew ? `${category} עד $${budget}` : `${category} under $${budget}`)
          : category ?? (budget !== undefined ? (isHebrew ? `מוצרים עד $${budget}` : `products under $${budget}`) : '');
        return <IntentSection key={outcome.intent.id} title={outcome.intent.goal} summary={isHebrew ? 'החיפוש הושלם וכל התנאים שסיפקת נשמרו.' : 'The search completed with every constraint you provided.'} status="empty" grouped={grouped} locale={locale}><RecommendationState state="empty" title={isHebrew ? `אין בקטלוג התאמות${filterSummary ? ` עבור ${filterSummary}` : ''}` : `No catalog products match${filterSummary ? ` ${filterSummary}` : ' these filters'}`} description={isHebrew ? 'אפשר להעלות את התקציב או לשנות תנאי אחר ואחפש שוב.' : 'Try raising the budget or relaxing another filter, and I’ll search again.'} /></IntentSection>;
      }
      return <IntentSection key={outcome.intent.id} title={outcome.intent.goal} summary={isHebrew ? `מצאתי ${outcome.products.length} אפשרויות מאומתות מהקטלוג, לפי מידת ההתאמה.` : `I found ${outcome.products.length} catalog-backed option${outcome.products.length === 1 ? '' : 's'}, ordered by match.`} status="completed" grouped={grouped} locale={locale}><PaginatedProductResults outcome={outcome} locale={locale} /></IntentSection>;
    })}
  </div>;
}

const PRODUCT_BATCH_SIZE = 5;

function PaginatedProductResults({ outcome, locale }: { outcome: OrchestrationResult['outcomes'][number]; locale: Locale }) {
  const [visibleCount, setVisibleCount] = useState(PRODUCT_BATCH_SIZE);
  const visible = outcome.products.slice(0, visibleCount);
  const remaining = outcome.products.length - visible.length;
  return <>
    <ProductGrid locale={locale} products={visible.map(({ product }) => product)} getMatchReasons={(product) => outcome.products.find((ranked) => ranked.product.id === product.id)?.matchReasons
      .filter(({ field }) => field !== 'category')
      .map(({ field, value }) => `${locale === 'he' ? (field === 'price' ? 'בתוך התקציב' : field === 'availability' ? 'זמינות' : field === 'rating' ? 'דירוג' : field === 'brand' ? 'מותג' : field === 'tags' ? 'תכונה רלוונטית' : 'כותרת רלוונטית') : (field === 'price' ? 'Within budget' : field === 'availability' ? 'Availability' : field === 'rating' ? 'Rating' : field === 'brand' ? 'Brand' : field === 'tags' ? 'Relevant feature' : 'Relevant title')}: ${value}`) ?? []} />
    {remaining > 0 && <button className="secondary-action" type="button" onClick={() => setVisibleCount((count) => Math.min(count + PRODUCT_BATCH_SIZE, outcome.products.length))}>{locale === 'he' ? `הצג עוד (${remaining} נותרו)` : `Show more (${remaining} remaining)`}</button>}
  </>;
}

export function CommerceExperience({
  providerEnabled,
  configurationError = '',
}: Props) {
  const [prompt, setPrompt] = useState('');
  const [lastPrompt, setLastPrompt] = useState('');
  const [result, setResult] = useState<OrchestrationResult>();
  const [pending, setPending] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState('');
  const [error, setError] = useState('');
  const [retryingIntentId, setRetryingIntentId] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [conversationId, setConversationId] = useState('');
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [entries, setEntries] = useState<ConversationEntry[]>([]);
  const [conversationListError, setConversationListError] = useState('');
  const [editingConversationId, setEditingConversationId] = useState('');
  const [editingTitle, setEditingTitle] = useState('');
  const [archivedConversation, setArchivedConversation] = useState<ConversationSummary>();
  const [selectedClarification, setSelectedClarification] = useState('');
  const [clarificationAnswer, setClarificationAnswer] = useState<ClarificationAnswer>();
  const [statusRetryAvailable, setStatusRetryAvailable] = useState(false);
  const [restoredStatus, setRestoredStatus] = useState('');
  const [uiLocale, setUiLocale] = useState<Locale>('en');
  const inFlight = useRef<{ generation: number; requestId: string } | undefined>(undefined);
  const restoreGeneration = useRef(0);

  const refreshConversationList = useCallback(async () => {
    try {
      const response = await fetch('/api/conversations');
      if (!response.ok) throw new Error('Saved conversations are temporarily unavailable.');
      const parsed = conversationListSchema.parse(await response.json());
      setConversations(parsed.conversations);
      setConversationListError('');
    } catch (caught) {
      setConversationListError(caught instanceof Error ? caught.message : 'Saved conversations are temporarily unavailable.');
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => void refreshConversationList(), 0);
    return () => clearTimeout(timeout);
  }, [refreshConversationList]);

  const restoreConversation = useCallback(async (id: string, generation: number): Promise<RestoreOutcome> => {
    const response = await fetch(`/api/orchestrate?conversationId=${encodeURIComponent(id)}`);
    if (generation !== restoreGeneration.current) return 'cancelled';
    if (response.status === 404) {
      setPending(false);
      setRestoredStatus('This conversation was not found. Start a new conversation to continue.');
      return 'terminal';
    }
    if (!response.ok) {
      if (response.status === 429 || response.status >= 500) throw new Error('Conversation state is temporarily unavailable.');
      setPending(false);
      setRestoredStatus('This conversation cannot be loaded. Start a new conversation to continue.');
      return 'terminal';
    }
    const state = conversationStateSchema.parse(await response.json());
    if (generation !== restoreGeneration.current) return 'cancelled';
    const latestTurn = state.turns.at(-1);
    const latestUserMessage = state.messages.filter(({ role }) => role === 'user').at(-1);
    setLastPrompt(latestUserMessage?.content ?? '');
    setResult(latestTurn?.result);
    setEntries(entriesFromState(state));
    setPendingPrompt('');
    setPending(latestTurn?.status === 'queued' || latestTurn?.status === 'running');
    setRestoredStatus(latestTurn?.status === 'queued' || latestTurn?.status === 'running'
      ? 'I’m still working on this shopping request.'
      : '');
    if (latestTurn?.status === 'queued' || latestTurn?.status === 'running') return 'running';
    return 'terminal';
  }, []);

  const recoverAcceptedConversation = useCallback(async (id: string, generation: number) => {
    const recovery = await recoverAcceptedTurn({
      read: () => restoreConversation(id, generation),
    });
    if (generation !== restoreGeneration.current) return;
    if (recovery === 'terminal' || recovery === 'cancelled') return;
    setPending(false);
    setStatusRetryAvailable(true);
    setRestoredStatus(recovery === 'still_running'
      ? 'This search is still running. You can check its saved status again.'
      : 'I can’t read this search status right now. You can check it again.');
  }, [restoreConversation]);

  useEffect(() => {
    const id = new URL(window.location.href).searchParams.get('conversation')?.trim();
    if (!id) return;
    const stableId = id;
    const generation = ++restoreGeneration.current;
    let active = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let transientFailures = 0;
    async function poll() {
      try {
        const outcome = await restoreConversation(stableId, generation);
        if (!active || generation !== restoreGeneration.current || outcome === 'cancelled') return;
        setConversationId(stableId);
        void refreshConversationList();
        transientFailures = 0;
        if (outcome === 'running') timeout = setTimeout(poll, 750);
      } catch {
        if (!active || generation !== restoreGeneration.current) return;
        const delay = restoreRetryDelays[transientFailures];
        transientFailures += 1;
        if (delay !== undefined) {
          timeout = setTimeout(poll, delay);
          return;
        }
        setPending(false);
        setConversationId(stableId);
        setRestoredStatus('I can’t load this saved conversation right now. Refresh the page to try again.');
      }
    }
    void poll();
    return () => {
      active = false;
      if (timeout) clearTimeout(timeout);
      if (restoreGeneration.current === generation) restoreGeneration.current += 1;
    };
  }, [restoreConversation, refreshConversationList]);

  async function runTurn(submitted: string, retryIntentId?: string) {
    if (inFlight.current?.generation === restoreGeneration.current) return;
    const activeConversationId = conversationId || crypto.randomUUID();
    const turnId = crypto.randomUUID();
    let generation = restoreGeneration.current;
    if (!conversationId) {
      generation = ++restoreGeneration.current;
      setConversationId(activeConversationId);
      const url = new URL(window.location.href);
      url.searchParams.set('conversation', activeConversationId);
      window.history.replaceState(null, '', url);
    }
    if (inFlight.current?.generation === generation) return;
    const request = { generation, requestId: turnId };
    inFlight.current = request;
    setPending(true);
    if (!retryIntentId) setPendingPrompt(submitted);
    setStatusRetryAvailable(false);
    setRetryingIntentId(retryIntentId ?? '');
    setError('');
    const controller = new AbortController();
    const requestTimeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetch('/api/orchestrate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          prompt: submitted,
          conversationId: activeConversationId,
          turnId,
          previous: result,
          retryIntentId,
          clarification: retryIntentId ? undefined : clarificationAnswer,
        }),
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message = typeof body === 'object' && body && 'error' in body && typeof body.error === 'object' && body.error && 'message' in body.error
          ? String(body.error.message) : 'The shopping turn failed.';
        throw new Error(message);
      }
      const parsed = orchestrationResponseSchema.parse(body);
      if (generation !== restoreGeneration.current || inFlight.current?.requestId !== request.requestId) return;
      setResult(parsed.result);
      setEntries((current) => {
        const withCompletedClarification = clarificationAnswer ? current.map((entry, index) => index === current.length - 1 ? {
          ...entry,
          completedClarifications: { ...entry.completedClarifications, [clarificationAnswer.intentId]: clarificationAnswer.value },
        } : entry) : current;
        return [...withCompletedClarification.filter(({ turnId: existingTurnId }) => existingTurnId !== turnId), {
          turnId, prompt: submitted, locale: localeFor(submitted), result: parsed.result,
        }];
      });
      setRestoredStatus('');
      setPendingPrompt('');
      setSelectedClarification('');
      setClarificationAnswer(undefined);
      if (!retryIntentId) setLastPrompt(submitted);
      void refreshConversationList();
    } catch (caught) {
      if (generation !== restoreGeneration.current || inFlight.current?.requestId !== request.requestId) return;
      if (caught instanceof DOMException && caught.name === 'AbortError') {
        setRestoredStatus('This search is taking longer than expected. I’m checking whether it finished.');
        await recoverAcceptedConversation(activeConversationId, generation);
        return;
      }
      if (!retryIntentId) setPrompt((current) => current.trim() ? current : submitted);
      setPendingPrompt('');
      setError(caught instanceof Error ? caught.message : 'The shopping turn failed.');
    } finally {
      clearTimeout(requestTimeout);
      if (inFlight.current?.requestId !== request.requestId) return;
      inFlight.current = undefined;
      if (generation !== restoreGeneration.current) return;
      setPending(false);
      setRetryingIntentId('');
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const submitted = prompt.trim();
    if (!submitted) return;
    setUiLocale(localeFor(submitted));
    setPrompt('');
    await runTurn(submitted);
  }

  async function retryIntent(intentId: string) {
    await runTurn(lastPrompt || prompt.trim(), intentId);
  }

  function clearConversation() {
    restoreGeneration.current += 1;
    inFlight.current = undefined;
    setResult(undefined); setEntries([]); setLastPrompt(''); setError(''); setRestoredStatus(''); setConversationId(''); setPending(false); setPendingPrompt('');
    setSelectedClarification('');
    setClarificationAnswer(undefined);
    setStatusRetryAvailable(false);
    const url = new URL(window.location.href); url.searchParams.delete('conversation'); window.history.replaceState(null, '', url);
  }

  const isEmptyConversation = entries.length === 0 && !lastPrompt && !pending && !error && !restoredStatus;

  const composer = (centered: boolean) => <div className={`composer-wrap ${centered ? 'composer-wrap--welcome' : ''}`}>
    <form onSubmit={submit} className="shopper-form">
      <label className="visually-hidden" htmlFor="shopper-prompt">{uiLocale === 'he' ? 'מה תרצה לקנות?' : 'What are you shopping for?'}</label>
      <textarea id="shopper-prompt" dir={uiLocale === 'he' ? 'rtl' : 'ltr'} value={prompt} onChange={(event) => {
        setPrompt(event.target.value);
        if (clarificationAnswer) {
          setClarificationAnswer(undefined);
          setSelectedClarification('');
        }
        if (event.target.value.trim()) setUiLocale(localeFor(event.target.value));
      }} onKeyDown={(event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          event.currentTarget.form?.requestSubmit();
        }
      }} rows={2} placeholder={uiLocale === 'he' ? 'שאלו על מוצר…' : 'Ask about a product…'} />
      <button className="primary-action" disabled={pending || !prompt.trim()} aria-label={uiLocale === 'he' ? (pending ? 'מחפש' : result ? 'עדכון תוצאות' : 'חיפוש מוצרים') : (pending ? 'Searching' : result ? 'Refine results' : 'Find products')}>{pending ? '…' : '↑'}</button>
    </form>
    <p>{uiLocale === 'he' ? 'Bazak עלול לטעות. כדאי לבדוק פרטי מוצר חשובים.' : 'Bazak can make mistakes. Check important product details.'}</p>
  </div>;

  function openConversation(id: string) {
    const url = new URL(window.location.href);
    url.searchParams.set('conversation', id);
    window.location.assign(url);
  }

  async function mutateConversation(id: string, mutation: { action: 'rename'; title: string } | { action: 'archive' } | { action: 'restore' }) {
    const response = await fetch(`/api/conversations?conversationId=${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(mutation),
    });
    if (!response.ok) throw new Error('The saved conversation could not be updated.');
    await refreshConversationList();
  }

  async function saveConversationTitle(id: string) {
    const title = editingTitle.trim();
    if (!title) return;
    try {
      await mutateConversation(id, { action: 'rename', title });
      setEditingConversationId('');
    } catch (caught) { setConversationListError(caught instanceof Error ? caught.message : 'Rename failed.'); }
  }

  async function archiveSavedConversation(conversation: ConversationSummary) {
    try {
      await mutateConversation(conversation.id, { action: 'archive' });
      setArchivedConversation(conversation);
      if (conversation.id === conversationId) clearConversation();
    } catch (caught) { setConversationListError(caught instanceof Error ? caught.message : 'Archive failed.'); }
  }

  async function undoArchive() {
    if (!archivedConversation) return;
    try {
      await mutateConversation(archivedConversation.id, { action: 'restore' });
      setArchivedConversation(undefined);
    } catch (caught) { setConversationListError(caught instanceof Error ? caught.message : 'Restore failed.'); }
  }

  return (
    <main id="main-content" className="app-shell">
      <a className="skip-link" href="#recommendations">Skip to recommendations</a>
      <aside className={`sidebar ${sidebarOpen ? 'sidebar--open' : ''}`} aria-label="Saved conversations">
        <div className="brand"><span className="brand__mark">B</span><strong>bazak</strong><button className="icon-button sidebar__close" type="button" onClick={() => setSidebarOpen(false)} aria-label="Close saved conversations">×</button></div>
        <button className="new-conversation" type="button" onClick={() => { clearConversation(); setSidebarOpen(false); }}>＋ New conversation</button>
        <p className="nav-label">Saved conversations</p>
        {conversationListError && <p className="sidebar-status" role="status">{conversationListError}</p>}
        <nav className="conversation-nav" aria-label="Conversation history">
          {conversations.length === 0 && !conversationListError && <p className="sidebar-status">Your first conversation appears here after you send a message.</p>}
          {conversations.map((conversation) => editingConversationId === conversation.id
            ? <form className="conversation-edit" key={conversation.id} onSubmit={(event) => { event.preventDefault(); void saveConversationTitle(conversation.id); }}>
              <label className="visually-hidden" htmlFor={`conversation-title-${conversation.id}`}>Conversation title</label>
              <input id={`conversation-title-${conversation.id}`} value={editingTitle} maxLength={80} onChange={(event) => setEditingTitle(event.target.value)} autoFocus />
              <button type="submit" disabled={!editingTitle.trim()}>Save</button><button type="button" onClick={() => setEditingConversationId('')}>Cancel</button>
            </form>
            : <div className={`conversation-nav__item ${conversation.id === conversationId ? 'active' : ''}`} key={conversation.id}>
              <button type="button" className="conversation-nav__open" aria-current={conversation.id === conversationId ? 'page' : undefined} onClick={() => openConversation(conversation.id)}><span>{conversation.title || 'Untitled conversation'}</span><small>{formatConversationDate(conversation.updatedAt)}</small></button>
              <button type="button" className="conversation-nav__action" aria-label={`Rename ${conversation.title || 'conversation'}`} onClick={() => { setEditingConversationId(conversation.id); setEditingTitle(conversation.title || ''); }}>✎</button>
              <button type="button" className="conversation-nav__action" aria-label={`Delete ${conversation.title || 'conversation'}`} onClick={() => void archiveSavedConversation(conversation)}>×</button>
            </div>)}
        </nav>
        {archivedConversation && <div className="archive-undo" role="status"><span>Conversation removed.</span><button type="button" onClick={() => void undoArchive()}>Undo</button></div>}
      </aside>
      {sidebarOpen && <button className="sidebar-scrim" type="button" aria-label="Close saved conversations" onClick={() => setSidebarOpen(false)} />}

      <section className="app-workspace">
        <header className="app-header">
          <button className="icon-button mobile-menu" type="button" onClick={() => setSidebarOpen(true)} aria-label="Open saved conversations">☰</button>
          <div className="app-title"><strong>Bazak</strong><span>Catalog-grounded shopping assistant</span></div>
        </header>

        <div className="app-content">
          <div className="chat-pane">
            <div className="chat-scroll" id="recommendations">
              {isEmptyConversation && <section className="welcome-message" aria-labelledby="welcome-title" dir={uiLocale === 'he' ? 'rtl' : 'ltr'}>
                <span className="welcome-message__mark" aria-hidden="true">B</span>
                <p className="welcome-message__eyebrow">BAZAK COMMERCE</p>
                <h1 id="welcome-title">{uiLocale === 'he' ? 'מוצאים מוצרים דרך שיחה.' : 'Find products through conversation.'}</h1>
                <p>{uiLocale === 'he' ? 'ספרו לי מה אתם מחפשים ואשווה אפשרויות מאומתות מהקטלוג.' : 'Tell me what you need and I’ll compare verified options from the catalog.'}</p>
                <p className="welcome-message__categories">{uiLocale === 'he' ? 'קטגוריות לדוגמה: סמארטפונים, מחשבים ניידים, בשמים, יופי, מזוודות ואביזרי מטבח.' : 'Try smartphones, laptops, fragrances, beauty, luggage, or kitchen accessories.'}</p>
                <div className="welcome-message__examples" aria-label={uiLocale === 'he' ? 'דוגמאות לחיפוש' : 'Example searches'}>
                  {(uiLocale === 'he' ? ['אני מחפש סמארטפון', 'יש לכם מזוודה לנסיעה?', 'אני רוצה בושם ליום יום'] : ['Find a smartphone', 'Show me travel luggage', 'Find an everyday fragrance']).map((example) => <button type="button" key={example} onClick={() => { setPrompt(example); setUiLocale(localeFor(example)); }}>{example}</button>)}
                </div>
                {!providerEnabled && <RecommendationState state="failure" title={uiLocale === 'he' ? 'החיפוש עדיין לא זמין' : 'I’m not ready to search yet'} description={configurationError || 'Product search is unavailable right now. Please try again later.'} />}
                {composer(true)}
              </section>}

              {(entries.length > 0 || pending || error || restoredStatus) && <section className="conversation" aria-labelledby="conversation-title">
                <h2 id="conversation-title" className="visually-hidden">Shopping conversation</h2>
                {entries.map((entry, index) => <div key={entry.turnId} className="conversation-turn" dir={entry.locale === 'he' ? 'rtl' : 'ltr'}>
                  <ConversationMessage role="user" locale={entry.locale}>{entry.prompt}</ConversationMessage>
                  {entry.failure && <ConversationMessage role="assistant" locale={entry.locale}>
                    <RecommendationState state="failure" title={entry.locale === 'he' ? 'לא הצלחתי להשלים את החיפוש' : 'I couldn’t finish this search'} description={entry.failure} />
                  </ConversationMessage>}
                  {entry.result && <ConversationMessage role="assistant" locale={entry.locale}>
                    <p className="assistant-summary">{entry.result.response}</p>
                    <ResultBlocks
                      result={entry.result}
                      actionable={index === entries.length - 1}
                      pending={pending}
                      retryingIntentId={retryingIntentId}
                      selectedClarification={selectedClarification}
                      completedClarifications={entry.completedClarifications}
                      onClarification={(intentId, _goal, field, option) => {
                        setSelectedClarification(option);
                        setClarificationAnswer({ intentId, field, value: option });
                        setPrompt(entry.locale === 'he' ? `בחרתי ${option}` : option);
                      }}
                      onRetry={(intentId) => void retryIntent(intentId)}
                      locale={entry.locale}
                    />
                  </ConversationMessage>}
                </div>)}
                {restoredStatus && <div className="conversation-turn conversation-turn--status"><ConversationMessage role="assistant">
                  <RecommendationState state="failure" title="About this search" description={restoredStatus} />
                  {statusRetryAvailable && conversationId && <button className="secondary-action recovery-action" type="button" onClick={() => { setStatusRetryAvailable(false); setPending(true); void recoverAcceptedConversation(conversationId, restoreGeneration.current); }}>Check this search again</button>}
                </ConversationMessage></div>}
                {pending && <div className="conversation-turn conversation-turn--active" dir={uiLocale === 'he' ? 'rtl' : 'ltr'}>
                  {pendingPrompt && <ConversationMessage role="user" locale={uiLocale}>{pendingPrompt}</ConversationMessage>}
                  <ConversationMessage role="assistant" locale={uiLocale}><ToolStatus state="loading" label={uiLocale === 'he' ? 'מחפש בקטלוג' : 'Searching the catalog'} detail={uiLocale === 'he' ? 'אני בודק עבורך אפשרויות מאומתות מהקטלוג.' : 'I’m checking trusted product options for you now.'} /><ProductGridSkeleton /></ConversationMessage>
                </div>}
                {error && <div className="conversation-turn conversation-turn--status" dir={uiLocale === 'he' ? 'rtl' : 'ltr'}><ConversationMessage role="assistant" locale={uiLocale}><RecommendationState state="failure" title={uiLocale === 'he' ? 'לא הצלחתי להשלים את החיפוש' : 'I couldn’t finish this search'} description={error} /></ConversationMessage></div>}
              </section>}
            </div>

            {!isEmptyConversation && composer(false)}
          </div>

        </div>
      </section>
    </main>
  );
}
