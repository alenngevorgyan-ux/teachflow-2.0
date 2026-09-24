import React, { useEffect, useState } from 'react';
import type { Language, MaterialItem, MaterialItemType } from '../../../shared/types';
import { Notice, StatusBadge } from '../../components/ui';
import { translations } from '../../i18n/translations';
import type { MaterialView } from './api';

interface Props {
  lang: Language;
  view: MaterialView;
  busy: boolean;
  error?: string | null;
  onPropose: () => void;
  onSave: (items: MaterialItem[], answerKeyParagraphIds: string[]) => void;
  onConfirm: () => void;
}

export function StructurePanel({ lang, view, busy, error, onPropose, onSave, onConfirm }: Props) {
  const m = translations[lang].materialReview;
  const seg = view.review.segmentation;
  const [draft, setDraft] = useState<MaterialItem[]>(view.structure.items);
  useEffect(() => setDraft(view.structure.items), [view.review.version]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(view.structure.items);
  const byId = new Map(view.paragraphs.map((p) => [p.id, p]));
  const textOf = (pid: string, start?: number, end?: number) => (byId.get(pid)?.text ?? '').slice(start ?? 0, end);
  const typeLabel: Record<MaterialItemType, string> = {
    single_choice: m.typeSingle,
    multiple_choice: m.typeMultiple,
    open: m.typeOpen,
    other: m.typeOther,
  };

  const update = (id: string, fn: (it: MaterialItem) => MaterialItem | null) =>
    setDraft((d) => d.map((it) => (it.id === id ? fn(it) : it)).filter((x): x is MaterialItem => x !== null));

  return (
    <section className="tf-section" aria-labelledby="structure-title">
      <h2 id="structure-title">{m.structureTitle}</h2>
      <p className="tf-meta" style={{ margin: 0 }}>
        {m.structureIntro}
      </p>
      {!seg && (
        <div className="tf-actions">
          <button className="tf-btn tf-btn--primary" disabled={busy} onClick={onPropose}>
            {busy ? m.running : m.proposeStructure}
          </button>
        </div>
      )}
      {seg && (
        <>
          <div className="tf-badges">
            <StatusBadge tone={seg.status === 'confirmed' ? 'pass' : 'warn'}>
              {seg.status === 'confirmed' ? m.structureConfirmed : seg.status === 'needs_reconfirmation' ? m.structureNeedsReconfirm : m.structureProposed}
            </StatusBadge>
          </div>
          <p className="tf-model" style={{ margin: 0 }}>
            {m.proposedBy}: {seg.model.providerId} / {seg.model.modelId} · {seg.model.promptVersion}
          </p>

          {draft.map((it) => (
            <div key={it.id} className="tf-structure-item">
              <div className="tf-actions" style={{ justifyContent: 'space-between' }}>
                <strong>
                  {m.question} {it.number}
                </strong>
                <label className="tf-field" style={{ flex: '0 1 14rem' }}>
                  <span>{m.type}</span>
                  <select
                    className="tf-select"
                    value={it.type}
                    onChange={(e) => update(it.id, (x) => ({ ...x, type: e.target.value as MaterialItemType }))}
                  >
                    {(Object.keys(typeLabel) as MaterialItemType[]).map((k) => (
                      <option key={k} value={k}>
                        {typeLabel[k]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p style={{ margin: 0, overflowWrap: 'anywhere' }}>
                {it.stemParagraphIds
                  .map((pid) => {
                    const sp = it.stemSpans?.find((s) => s.paragraphId === pid);
                    return sp ? textOf(pid, sp.start, sp.end) : textOf(pid);
                  })
                  .join(' ')}
              </p>
              {it.options.map((o) => (
                <div key={`${o.paragraphId}-${o.start}`} className="tf-option-row">
                  <span style={{ flex: 1, minInlineSize: 0, overflowWrap: 'anywhere' }}>{textOf(o.paragraphId, o.start, o.end)}</span>
                  <button
                    className="tf-btn tf-btn--small tf-btn--quiet"
                    onClick={() => update(it.id, (x) => ({ ...x, options: x.options.filter((y) => y !== o) }))}
                    aria-label={`${m.removeOption}: ${textOf(o.paragraphId, o.start, o.end)}`}
                  >
                    {m.removeOption}
                  </button>
                </div>
              ))}
              <div className="tf-actions">
                <button className="tf-btn tf-btn--small" onClick={() => update(it.id, () => null)} aria-label={`${m.removeQuestion} ${it.number}`}>
                  {m.removeQuestion}
                </button>
              </div>
            </div>
          ))}

          {seg.problems.length > 0 && (
            <details className="tf-evidence">
              <summary>
                {m.problemsTitle} ({seg.problems.length})
              </summary>
              <ul>
                {seg.problems.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </details>
          )}
          {view.unassignedParagraphIds.length > 0 && (
            <details className="tf-evidence">
              <summary>
                {m.unassignedTitle} ({view.unassignedParagraphIds.length})
              </summary>
              <p className="tf-meta">{m.unassignedNote}</p>
              <ul>
                {view.unassignedParagraphIds.map((id) => (
                  <li key={id} style={{ overflowWrap: 'anywhere' }}>
                    {textOf(id)}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {dirty && <Notice tone="warn">{m.structureDirty}</Notice>}
          {error && (
            <Notice tone="fail" role="alert">
              {error}
            </Notice>
          )}
          <div className="tf-actions">
            {dirty ? (
              <>
                <button className="tf-btn tf-btn--primary" disabled={busy} onClick={() => onSave(draft, seg.answerKeyParagraphIds)}>
                  {m.saveStructure}
                </button>
                <button className="tf-btn" disabled={busy} onClick={() => setDraft(view.structure.items)}>
                  {m.discardStructure}
                </button>
              </>
            ) : (
              seg.status !== 'confirmed' && (
                <button className="tf-btn tf-btn--primary" disabled={busy} onClick={onConfirm}>
                  {m.confirmStructure}
                </button>
              )
            )}
            <button className="tf-btn tf-btn--quiet" disabled={busy} onClick={onPropose}>
              {m.proposeStructure}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
