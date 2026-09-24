import React, { useState } from 'react';
import type { Language, MaterialAnswerKeyEntry, MaterialCheck, MaterialItem, MaterialItemResult, MaterialSuggestion } from '../../../shared/types';
import { StatusBadge, Tone } from '../../components/ui';
import { translations } from '../../i18n/translations';

export type ItemState = 'checked' | 'needs_decision' | 'unchecked';

export function itemState(result: MaterialItemResult | undefined, _revision: string): ItemState {
  if (!result || result.stale) return 'unchecked';
  if (result.checks.some((c) => c.status === 'fail' || c.status === 'needs_review')) return 'needs_decision';
  if (result.checks.some((c) => c.status === 'not_evaluated')) return 'unchecked';
  return 'checked';
}

const OUTCOME_TONE: Record<MaterialCheck['status'], Tone> = { pass: 'pass', fail: 'fail', needs_review: 'warn', not_evaluated: 'neutral' };

interface Props {
  lang: Language;
  item: MaterialItem;
  itemText: string;
  optionTexts: { label: string; text: string }[];
  result?: MaterialItemResult;
  answerKey?: MaterialAnswerKeyEntry;
  suggestions: MaterialSuggestion[];
  problems?: string[];
  revision: string;
  selected: boolean;
  busy: boolean;
  segmentationConfirmed: boolean;
  sourceTitle: (id: string) => string;
  onSelect: () => void;
  onShowInDocument: () => void;
  onAccept: (suggestionId: string, replacements?: Record<string, string>) => void;
  onReject: (suggestionId: string) => void;
  onSetKey: (labels: string[]) => void;
  error?: string | null;
}

export function FindingCard(p: Props) {
  const m = translations[p.lang].materialReview;
  const [editing, setEditing] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [keyDraft, setKeyDraft] = useState<string>('');
  const state = itemState(p.result, p.revision);
  const stale = !!p.result && p.result.stale;
  const choice = p.item.type === 'single_choice' || p.item.type === 'multiple_choice';
  const stateLabel = state === 'checked' ? m.itemChecked : state === 'needs_decision' ? m.itemNeedsDecision : m.itemUnchecked;
  const stateTone: Tone = state === 'checked' ? 'pass' : state === 'needs_decision' ? 'warn' : 'neutral';
  const headingId = `finding-${p.item.id}`;

  return (
    <article className="tf-finding" data-selected={p.selected} aria-labelledby={headingId}>
      <div className="tf-badges">
        <StatusBadge tone={stateTone}>{stateLabel}</StatusBadge>
        {stale && (
          <StatusBadge tone="warn" icon="clock">
            {m.stale}
          </StatusBadge>
        )}
      </div>
      <h3 id={headingId} style={{ margin: 0, fontSize: '1rem' }}>
        <button className="tf-finding-title" onClick={p.onSelect} aria-pressed={p.selected}>
          {m.question} {p.item.number}. {p.itemText.length > 140 ? `${p.itemText.slice(0, 140)}…` : p.itemText}
        </button>
      </h3>
      <div className="tf-actions">
        <button className="tf-btn tf-btn--quiet tf-btn--small" onClick={p.onShowInDocument}>
          {m.viewDocument}
        </button>
      </div>

      {choice && (
        <p className="tf-meta" style={{ margin: 0 }}>
          {m.options}: {p.optionTexts.map((o) => o.label).join(', ') || '—'} · {m.key}:{' '}
          {p.answerKey ? `${p.answerKey.optionLabels.join(', ')} (${p.answerKey.origin === 'teacher' ? m.keyFromTeacher : m.keyFromDocument})` : m.keyMissing}
        </p>
      )}

      {choice && p.segmentationConfirmed && p.answerKey?.origin !== 'document' && (
        <div className="tf-actions">
          <label className="tf-field" style={{ flex: '1 1 10rem' }}>
            <span>{m.setKey}</span>
            <select className="tf-select" value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)}>
              <option value="">—</option>
              {p.optionTexts.map((o) => (
                <option key={o.label} value={o.label}>
                  {o.text}
                </option>
              ))}
            </select>
          </label>
          <button className="tf-btn tf-btn--small" disabled={!keyDraft || p.busy} onClick={() => p.onSetKey([keyDraft])} style={{ alignSelf: 'end' }}>
            {m.saveKey}
          </button>
          <p className="tf-meta" style={{ margin: 0, flexBasis: '100%' }}>
            {m.keyNotEvidence} {m.keyTeacherNote}
          </p>
        </div>
      )}

      {!p.result && <p className="tf-meta">{m.noChecksYet}</p>}
      {p.result?.checks.map((c) => (
        <div key={c.checkId} className="tf-check-row">
          <header>
            <span>{(m as Record<string, string>)[`check_${c.checkId}`] ?? c.checkId}</span>
            <StatusBadge tone={OUTCOME_TONE[c.status]}>{(m as Record<string, string>)[`checkStatus_${c.status}`]}</StatusBadge>
          </header>
          <p>{c.detail}</p>
          {c.executionError && <p className="tf-meta">{m.executionError}</p>}
          {c.outcomeCodes?.length ? (
            <p className="tf-meta">
              {m.outcomeCodes}: {c.outcomeCodes.join(', ')}
            </p>
          ) : null}
          {c.evidence?.map((e) => (
            <details key={e.chunkId} className="tf-evidence">
              <summary>
                {m.evidence}: {p.sourceTitle(e.sourceId)} · {m.version} {e.sourceVersion}
                {e.page ? ` · ${m.page} ${e.page}` : ''}
              </summary>
              <blockquote>{e.text}</blockquote>
              <p className="tf-meta" style={{ margin: 0 }}>
                {e.chunkId}. {m.evidenceNote}
              </p>
            </details>
          ))}
          <span className="tf-model">
            {c.kind === 'deterministic' ? m.deterministic : m.modelJudged}
            {c.model ? ` · ${c.model.providerId} / ${c.model.modelId} · ${c.model.promptVersion}` : ''}
          </span>
        </div>
      ))}

      {p.suggestions.map((s) => {
        const pending = s.status === 'proposed';
        const isEditing = editing === s.id;
        const statusText = s.status === 'accepted' ? (s.recheck === 'pending' ? m.recheckPending : m.accepted) : s.status === 'rejected' ? m.rejected : null;
        return (
          <div key={s.id} className="tf-check-row" style={{ gap: 10 }}>
            <header>
              <span>{m.suggestion}</span>
              {statusText && <StatusBadge tone={s.status === 'accepted' ? (s.recheck === 'pending' ? 'warn' : 'pass') : 'neutral'}>{statusText}</StatusBadge>}
            </header>
            {s.group.patches.length > 1 && <p className="tf-meta">{m.linkedEdits}</p>}
            <div className="tf-diff">
              {s.group.patches.map((patch) => (
                <div key={patch.id}>
                  <span className="tf-diff-label">{m.before}</span>
                  <del>{patch.expected}</del>
                  <span className="tf-diff-label">{m.after}</span>
                  {pending && isEditing ? (
                    <input
                      className="tf-input"
                      aria-label={`${m.after}: ${patch.expected}`}
                      value={drafts[patch.id] ?? patch.replacement}
                      onChange={(e) => setDrafts({ ...drafts, [patch.id]: e.target.value })}
                    />
                  ) : (
                    <ins>{drafts[patch.id] ?? patch.replacement}</ins>
                  )}
                </div>
              ))}
            </div>
            {s.keyChange && (
              <p style={{ margin: 0 }}>
                {m.newKey}: <strong>{s.keyChange.join(', ')}</strong>
              </p>
            )}
            <p style={{ margin: 0 }}>
              <span className="tf-meta">{m.rationale}: </span>
              {s.rationale}
            </p>
            {s.evidence?.map((e) => (
              <details key={e.chunkId + e.text} className="tf-evidence">
                <summary>
                  {m.evidence}: {p.sourceTitle(e.sourceId)} · {m.version} {e.sourceVersion}
                </summary>
                <blockquote>{e.text}</blockquote>
              </details>
            ))}
            <span className="tf-model">
              {s.model.providerId} / {s.model.modelId}
              {s.editedByTeacher ? ` · ${m.edited}` : ''}
            </span>
            {pending && (
              <>
                {isEditing && <p className="tf-meta">{m.editHint}</p>}
                <div className="tf-actions">
                  <button
                    className="tf-btn tf-btn--primary"
                    disabled={p.busy || stale}
                    onClick={() => p.onAccept(s.id, Object.keys(drafts).length ? drafts : undefined)}
                  >
                    {p.busy ? m.applying : m.accept}
                  </button>
                  <button className="tf-btn" disabled={p.busy} onClick={() => p.onReject(s.id)}>
                    {m.reject}
                  </button>
                  <button className="tf-btn tf-btn--quiet" disabled={p.busy || stale} onClick={() => setEditing(isEditing ? null : s.id)} aria-expanded={isEditing}>
                    {m.editProposal}
                  </button>
                </div>
                <p className="tf-meta" style={{ margin: 0 }}>
                  {m.rejectNote}
                </p>
              </>
            )}
          </div>
        );
      })}

      {p.problems?.length ? (
        <div className="tf-notice" data-tone="info">
          {p.problems.map((x, i) => (
            <div key={i}>{x}</div>
          ))}
        </div>
      ) : null}
      {p.error && (
        <div className="tf-notice" data-tone="error" role="alert">
          {p.error}
        </div>
      )}
    </article>
  );
}
