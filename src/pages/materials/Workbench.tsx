import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Download, RotateCcw } from 'lucide-react';
import type { Language, MaterialItem, MaterialRun } from '../../../shared/types';
import { LiveRegion, Notice, Stage, StageBar, StatusBadge } from '../../components/ui';
import { translations } from '../../i18n/translations';
import { ApiError, MaterialView, RegistrySource, api, json } from './api';
import { DocumentPreview } from './DocumentPreview';
import { FindingCard, itemState } from './FindingCard';
import { StructurePanel } from './StructurePanel';

interface Props {
  lang: Language;
  materialId: string;
  onBack: () => void;
}

type Busy = null | { kind: string; target?: string };
type Filter = 'actionable' | 'not_evaluated' | 'resolved' | 'all';
type SaveState = 'saved' | 'saving' | 'saveError';

export function Workbench({ lang, materialId, onBack }: Props) {
  const m = translations[lang].materialReview;
  const [view, setView] = useState<MaterialView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sources, setSources] = useState<RegistrySource[]>([]);
  const [busy, setBusy] = useState<Busy>(null);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [announce, setAnnounce] = useState('');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const [filter, setFilter] = useState<Filter>('actionable');
  const [mobileView, setMobileView] = useState<'document' | 'findings'>('document');
  const [programIds, setProgramIds] = useState<string[]>([]);
  const [factIds, setFactIds] = useState<string[]>([]);
  const [problems, setProblems] = useState<Record<string, string[]>>({});

  const load = useCallback(async () => {
    try {
      const v = await api<MaterialView>(`/api/materials/${materialId}`);
      setView(v);
      setLoadError(null);
      return v;
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, [materialId]);

  useEffect(() => {
    load();
    api<{ sources: RegistrySource[] }>('/api/sources')
      .then((d) => setSources(d.sources))
      .catch(() => setSources([]));
  }, [load]);

  useEffect(() => {
    if (!view) return;
    setProgramIds(view.review.selectedSources.filter((s) => s.purpose === 'program').map((s) => s.sourceId));
    setFactIds(view.review.selectedSources.filter((s) => s.purpose === 'fact').map((s) => s.sourceId));
  }, [view?.review.id, view?.review.version]);

  /** Runs one mutation; the view changes only once the server confirmed it. */
  const mutate = async (kind: string, section: string, url: string, init: RequestInit, target?: string, doneMessage?: string) => {
    setBusy({ kind, target });
    setSaveState('saving');
    setErrors((e) => ({ ...e, [section]: null }));
    try {
      const v = await api<MaterialView>(url, init);
      setView(v);
      if (v.suggestionProblems) setProblems(v.suggestionProblems);
      setSaveState('saved');
      setAnnounce(doneMessage ?? m.announceSaved);
    } catch (e) {
      setSaveState('saveError');
      if (e instanceof ApiError && e.isConflict) {
        await load();
        setErrors((x) => ({ ...x, [section]: `${m.conflict} ${e.message}` }));
      } else {
        setErrors((x) => ({ ...x, [section]: e instanceof ApiError && e.status === 0 ? m.network : e instanceof Error ? e.message : String(e) }));
        // A failed model run is recorded on the server; show its state.
        await load();
      }
    } finally {
      setBusy(null);
    }
  };

  const sourceTitle = (id: string) => sources.find((s) => s.id === id)?.title ?? id;

  if (loadError && !view) {
    return (
      <div className="tf-page">
        <Notice tone="fail" title={m.saveError} role="alert">
          {loadError}
        </Notice>
        <div className="tf-actions">
          <button className="tf-btn" onClick={load}>
            {m.retryFailed}
          </button>
          <button className="tf-btn tf-btn--quiet" onClick={onBack}>
            {m.backToList}
          </button>
        </div>
      </div>
    );
  }
  if (!view) return <div className="tf-page"><p className="tf-meta">{m.running}</p></div>;

  const { review, status } = view;
  const seg = review.segmentation;
  const items = view.structure.items;
  const confirmed = seg?.status === 'confirmed';
  const byParagraph = new Map(view.paragraphs.map((p) => [p.id, p]));
  const textOfItem = (it: MaterialItem) =>
    it.stemParagraphIds
      .map((pid) => {
        const t = byParagraph.get(pid)?.text ?? '';
        const sp = it.stemSpans?.find((s) => s.paragraphId === pid);
        return sp ? t.slice(sp.start, sp.end) : t;
      })
      .join(' ');
  const optionTexts = (it: MaterialItem) => it.options.map((o) => ({ label: o.label, text: (byParagraph.get(o.paragraphId)?.text ?? '').slice(o.start, o.end) }));
  const resultOf = (id: string) => review.results.find((r) => r.itemId === id);
  const running = review.runs.filter((r) => r.status === 'running');
  const lastRun: MaterialRun | undefined = review.runs[review.runs.length - 1];
  const anyBusy = busy !== null || running.length > 0;

  // ---- stages derived from real state
  const allChecked = confirmed && items.length > 0 && items.every((it) => itemState(resultOf(it.id), review.revision) !== 'unchecked' || resultOf(it.id)?.checks.some((c) => c.status === 'not_evaluated'));
  const unresolved = status.counts.fail + status.counts.needs_review;
  const stageStates: Stage['state'][] = [
    'done',
    confirmed ? 'done' : 'current',
    !confirmed ? 'todo' : allChecked && status.counts.staleItems === 0 && status.counts.uncheckedItems === 0 ? 'done' : 'current',
    !confirmed || !allChecked ? 'todo' : unresolved > 0 || status.counts.pendingSuggestions > 0 ? 'current' : 'done',
    !confirmed || !allChecked || unresolved > 0 || status.counts.pendingSuggestions > 0 ? 'todo' : 'current',
  ];
  const stageLabels = [m.stageUpload, m.stageStructure, m.stageCheck, m.stageReview, m.stageExport];
  const stages: Stage[] = stageLabels.map((label, i) => ({ id: String(i), label, state: stageStates[i] }));

  // ---- primary next action
  const post = (url: string, body: unknown = {}) => json('POST', body);
  const next: { label: string; run: () => void } | null = !seg
    ? { label: m.proposeStructure, run: () => mutate('segment', 'structure', `/api/materials/${review.id}/segment`, post('')) }
    : !confirmed
    ? { label: m.confirmStructure, run: () => mutate('confirm', 'structure', `/api/materials/${review.id}/segmentation/confirm`, json('POST', { expectedRevision: review.revision })) }
    : status.counts.uncheckedItems + status.counts.staleItems > 0
    ? { label: m.runChecks, run: () => mutate('check', 'checks', `/api/materials/${review.id}/check`, post(''), undefined, m.announceChecked) }
    : status.counts.executionErrors > 0
    ? { label: m.retryFailed, run: () => mutate('check', 'checks', `/api/materials/${review.id}/check`, json('POST', { retryFailed: true }), undefined, m.announceChecked) }
    : unresolved > 0 && status.counts.pendingSuggestions === 0
    ? { label: m.suggestFixes, run: () => mutate('suggest', 'checks', `/api/materials/${review.id}/suggest`, post('')) }
    : null;

  // ---- findings filter
  const isActionable = (it: MaterialItem) => {
    const r = resultOf(it.id);
    const st = itemState(r, review.revision);
    return st === 'needs_decision' || !r || r.stale || review.suggestions.some((s) => s.itemId === it.id && s.status === 'proposed');
  };
  const hasNotEvaluated = (it: MaterialItem) => !!resultOf(it.id)?.checks.some((c) => c.status === 'not_evaluated');
  const visibleItems = items.filter((it) =>
    filter === 'all' ? true : filter === 'actionable' ? isActionable(it) : filter === 'not_evaluated' ? hasNotEvaluated(it) : itemState(resultOf(it.id), review.revision) === 'checked'
  );
  const attention = new Set(items.filter((it) => itemState(resultOf(it.id), review.revision) === 'needs_decision').map((it) => it.id));
  const changedIds = new Set(review.acceptedGroups.flatMap((g) => g.patches.map((p) => p.paragraphId)));
  const notEvaluatedItems = items.filter(hasNotEvaluated).length;

  const eligible = (purpose: 'program' | 'fact') =>
    sources.filter(
      (s) => s.subject === review.subject && s.grades.includes(review.grade) && (purpose === 'program'
          ? s.docType === 'standard' || s.docType === 'subject_program'
          : s.role === 'FACT' && s.docType !== 'standard' && s.docType !== 'subject_program')
    );
  const anyConfirmed = [...eligible('program'), ...eligible('fact')].some((s) => s.confirmationState === 'confirmed');
  const nProgram = review.selectedSources.filter((s) => s.purpose === 'program').length;
  const nFact = review.selectedSources.length - nProgram;
  const selectedSummary = review.selectedSources.length ? `${m.programSources} ${nProgram} · ${m.factSources} ${nFact}` : '';

  const sourcePicker = (purpose: 'program' | 'fact') => {
    const list = eligible(purpose);
    const sel = purpose === 'program' ? programIds : factIds;
    const set = purpose === 'program' ? setProgramIds : setFactIds;
    return (
      <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'grid', gap: 4 }}>
        <legend style={{ fontWeight: 600, marginBlockEnd: 4 }}>{purpose === 'program' ? m.programSources : m.factSources}</legend>
        {list.length === 0 && <span className="tf-meta">—</span>}
        {list.map((s) => {
          const ok = s.confirmationState === 'confirmed';
          const stateText = (m as Record<string, string>)[s.confirmationState] ?? s.confirmationState;
          return (
            <label key={s.id} className="tf-check" style={{ opacity: ok ? 1 : 0.75 }}>
              <input type="checkbox" disabled={!ok || anyBusy} checked={sel.includes(s.id)} onChange={() => set(sel.includes(s.id) ? sel.filter((x) => x !== s.id) : [...sel, s.id])} />
              <span style={{ display: 'grid', gap: 4, minInlineSize: 0 }}>
                <span style={{ overflowWrap: 'anywhere' }}>{s.title}</span>
                <span className="tf-badges">
                  <StatusBadge tone={ok ? 'pass' : s.confirmationState === 'invalidated' ? 'fail' : 'neutral'}>{stateText}</StatusBadge>
                  <span className="tf-badge">
                    {m.version} {s.version}
                  </span>
                  {s.isDemo && <StatusBadge tone="info">{m.demo}</StatusBadge>}
                </span>
                <span className="tf-meta">
                  {m.authorityStated}: {s.authority}
                  {ok && s.confirmation ? ` · ${m.confirmedBy}: ${s.confirmation.confirmedByName} (${m.statedName})` : ''}
                  {!ok && s.confirmationReason ? ` · ${s.confirmationReason}` : ''}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>
    );
  };

  const exportBlocked = anyBusy;
  const downloadLink = (href: string, label: string, primary = false) => (
    <a
      className={`tf-btn${primary ? ' tf-btn--primary' : ''}`}
      href={exportBlocked ? undefined : href}
      aria-disabled={exportBlocked}
      onClick={(e) => exportBlocked && e.preventDefault()}
      download
    >
      <Download aria-hidden />
      {label}
    </a>
  );

  return (
    <div>
      <LiveRegion message={announce} />
      <header className="tf-review-head">
        <div className="tf-actions">
          <button className="tf-btn tf-btn--quiet tf-btn--small" onClick={onBack}>
            <ArrowLeft aria-hidden />
            {m.backToList}
          </button>
        </div>
        <div className="tf-review-title">
          <div style={{ minInlineSize: 0 }}>
            <p className="tf-eyebrow">{m.eyebrow}</p>
            <h1>{review.fileName}</h1>
            <div className="tf-review-meta">
              <span role="status">{saveState === 'saving' ? m.saving : saveState === 'saveError' ? m.saveError : m.saved}</span>
              <span>
                {m.revision}: <code>{review.revision}</code>
              </span>
              <span>
                {review.subject}, {review.grade}
              </span>
              <span>
                {m.sourcesContext}: {selectedSummary || m.noSourcesSelected}
              </span>
              <StatusBadge tone={status.final ? 'pass' : 'warn'}>{status.final ? m.final : m.draft}</StatusBadge>
            </div>
          </div>
          <div className="tf-actions">
            {next ? (
              <button className="tf-btn tf-btn--primary" disabled={anyBusy} onClick={next.run}>
                {anyBusy ? m.running : next.label}
              </button>
            ) : (
              downloadLink(`/api/materials/${review.id}/export.docx`, m.downloadCorrected, true)
            )}
          </div>
        </div>
        <StageBar stages={stages} label={m.stagesLabel} />
      </header>

      <div style={{ padding: '16px 28px 0', display: 'grid', gap: 12 }}>
        {review.selectedSources.length === 0 && <Notice tone="info">{anyConfirmed ? m.onlyConfirmed : m.noConfirmed}</Notice>}
        {lastRun && (lastRun.status === 'failed' || lastRun.status === 'obsolete' || lastRun.status === 'running') && (
          <Notice tone={lastRun.status === 'failed' ? 'fail' : lastRun.status === 'running' ? 'info' : 'warn'} role="status">
            {(m as Record<string, string>)[`runKind_${lastRun.kind}`]}:{' '}
            {lastRun.status === 'running' ? m.running : lastRun.status === 'failed' ? `${m.runFailed}. ${lastRun.error ?? ''}` : m.runObsolete}
          </Notice>
        )}
      </div>

      <div className="tf-view-switch tf-segmented" role="group" aria-label={m.viewDocument} style={{ margin: '16px 16px 0' }}>
        <button aria-pressed={mobileView === 'document'} onClick={() => setMobileView('document')}>
          {m.viewDocument}
        </button>
        <button aria-pressed={mobileView === 'findings'} onClick={() => setMobileView('findings')}>
          {m.viewFindings}
        </button>
      </div>

      <div className="tf-workbench" data-view={mobileView}>
        <section className="tf-paper" aria-labelledby="doc-title">
          <div className="tf-paper-head">
            <h2 id="doc-title">{m.document}</h2>
            <span className="tf-meta">{m.previewNote}</span>
          </div>
          <DocumentPreview
            lang={lang}
            paragraphs={view.paragraphs}
            items={items}
            answerKey={view.structure.answerKey}
            keyParagraphIds={seg?.answerKeyParagraphIds ?? []}
            unassignedIds={view.unassignedParagraphIds}
            changedIds={changedIds}
            attentionItemIds={attention}
            selectedItemId={selectedItemId}
            focusRequest={focusRequest}
          />
        </section>

        <aside className="tf-panel" aria-labelledby="findings-title">
          <div className="tf-panel-head">
            <h2 id="findings-title" style={{ margin: 0, fontSize: '1.1rem' }}>
              {m.findings}
            </h2>
            <dl className="tf-counts">
              <div>
                <dt>{m.countUnresolved}</dt>
                <dd>{unresolved}</dd>
              </div>
              <div>
                <dt>{m.countNotEvaluated}</dt>
                <dd>{status.counts.not_evaluated}</dd>
              </div>
              <div>
                <dt>{m.countPendingRecheck}</dt>
                <dd>{status.counts.pendingRechecks + status.counts.staleItems}</dd>
              </div>
            </dl>
            {!status.final && (
              <details className="tf-evidence">
                <summary>{m.draftWarning}</summary>
                <ul style={{ margin: 0, paddingInlineStart: 20 }}>
                  {status.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </details>
            )}
            <label className="tf-field">
              <span>{m.filter}</span>
              <select className="tf-select" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
                <option value="actionable">{m.filterActionable}</option>
                <option value="not_evaluated">{m.filterNotEvaluated}</option>
                <option value="resolved">{m.filterResolved}</option>
                <option value="all">{m.filterAll}</option>
              </select>
            </label>
            {filter === 'actionable' && notEvaluatedItems > 0 && (
              <button className="tf-btn tf-btn--quiet tf-btn--small" onClick={() => setFilter('not_evaluated')}>
                {m.countNotEvaluated}: {notEvaluatedItems} {m.questionsCount}
              </button>
            )}
            {confirmed && (
              <div className="tf-actions">
                <button
                  className="tf-btn tf-btn--small"
                  disabled={anyBusy}
                  onClick={() => mutate('check', 'checks', `/api/materials/${review.id}/check`, post(''), undefined, m.announceChecked)}
                >
                  {m.runChecks}
                </button>
                {status.counts.executionErrors > 0 && (
                  <button
                    className="tf-btn tf-btn--small"
                    disabled={anyBusy}
                    onClick={() => mutate('check', 'checks', `/api/materials/${review.id}/check`, json('POST', { retryFailed: true }), undefined, m.announceChecked)}
                  >
                    {m.retryFailed}
                  </button>
                )}
                <button className="tf-btn tf-btn--small" disabled={anyBusy || unresolved === 0} onClick={() => mutate('suggest', 'checks', `/api/materials/${review.id}/suggest`, post(''))}>
                  {m.suggestFixes}
                </button>
              </div>
            )}
            {errors.checks && (
              <Notice tone="fail" role="alert">
                {errors.checks}
              </Notice>
            )}
          </div>

          {!confirmed && <p className="tf-empty">{m.structureIntro}</p>}
          {confirmed && visibleItems.length === 0 && <p className="tf-empty">{m.emptyFilter}</p>}
          {confirmed &&
            visibleItems.map((it) => (
              <FindingCard
                key={it.id}
                lang={lang}
                item={it}
                itemText={textOfItem(it)}
                optionTexts={optionTexts(it)}
                result={resultOf(it.id)}
                answerKey={view.structure.answerKey.find((k) => k.itemId === it.id)}
                suggestions={review.suggestions.filter((s) => s.itemId === it.id && s.status !== 'superseded')}
                problems={problems[it.id]}
                revision={review.revision}
                selected={selectedItemId === it.id}
                busy={anyBusy}
                segmentationConfirmed={confirmed}
                sourceTitle={sourceTitle}
                error={errors[`item-${it.id}`]}
                onSelect={() => setSelectedItemId(it.id === selectedItemId ? null : it.id)}
                onShowInDocument={() => {
                  setSelectedItemId(it.id);
                  setMobileView('document');
                  setFocusRequest((n) => n + 1);
                }}
                onAccept={(sid, replacements) =>
                  mutate('decide', `item-${it.id}`, `/api/materials/${review.id}/suggestions/${sid}/decision`, json('POST', { decision: 'accept', expectedRevision: review.revision, replacements }), sid)
                }
                onReject={(sid) =>
                  mutate('decide', `item-${it.id}`, `/api/materials/${review.id}/suggestions/${sid}/decision`, json('POST', { decision: 'reject', expectedRevision: review.revision }), sid)
                }
                onSetKey={(labels) => mutate('key', `item-${it.id}`, `/api/materials/${review.id}/items/${it.id}/key`, json('PUT', { optionLabels: labels }))}
              />
            ))}
        </aside>
      </div>

      <div className="tf-page" style={{ paddingBlockStart: 0 }}>
        <section className="tf-section" aria-labelledby="sources-title">
          <h2 id="sources-title">{m.sourcesTitle}</h2>
          <p className="tf-meta" style={{ margin: 0 }}>
            {m.onlyConfirmed} {m.confirmationNote}
          </p>
          {!anyConfirmed && <Notice tone="info">{m.noConfirmed}</Notice>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(18rem, 1fr))', gap: 16 }}>
            {sourcePicker('program')}
            {sourcePicker('fact')}
          </div>
          {errors.sources && (
            <Notice tone="fail" role="alert">
              {errors.sources}
            </Notice>
          )}
          <div className="tf-actions">
            <button
              className="tf-btn"
              disabled={anyBusy}
              onClick={() => mutate('sources', 'sources', `/api/materials/${review.id}/sources`, json('PUT', { programSourceIds: programIds, factSourceIds: factIds }))}
            >
              {m.saveSources}
            </button>
          </div>
        </section>

        <StructurePanel
          lang={lang}
          view={view}
          busy={anyBusy}
          error={errors.structure}
          onPropose={() => mutate('segment', 'structure', `/api/materials/${review.id}/segment`, post(''))}
          onSave={(its, keyParas) =>
            mutate('structure', 'structure', `/api/materials/${review.id}/segmentation`, json('PUT', { expectedRevision: review.revision, items: its, answerKeyParagraphIds: keyParas }))
          }
          onConfirm={() => mutate('confirm', 'structure', `/api/materials/${review.id}/segmentation/confirm`, json('POST', { expectedRevision: review.revision }))}
        />

        {review.preservation.length > 0 && (
          <section className="tf-section" aria-labelledby="preservation-title">
            <h2 id="preservation-title">{m.preservationTitle}</h2>
            <ul style={{ margin: 0, paddingInlineStart: 20 }}>
              {review.preservation.map((p) => (
                <li key={p.kind}>
                  {p.note} ({p.count}){!p.textChecked && <strong> — {m.notPrivacyChecked}</strong>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="tf-section" aria-labelledby="export-title">
          <h2 id="export-title">{m.exportTitle}</h2>
          <Notice tone={status.final ? 'pass' : 'warn'} title={status.final ? m.finalNote : m.draftWarning}>
            {!status.final && (
              <ul>
                {status.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
          </Notice>
          <p style={{ margin: 0 }}>{m.exportContains}</p>
          <p className="tf-meta" style={{ margin: 0 }}>
            {m.revision}: <code>{review.revision}</code> · SHA-256 ({m.downloadOriginal}): <code style={{ overflowWrap: 'anywhere' }}>{review.fileSha256}</code>
          </p>
          <p className="tf-meta" style={{ margin: 0 }}>
            {m.layoutNote}
          </p>
          {exportBlocked && <p className="tf-meta">{m.busyNote}</p>}
          <div className="tf-actions">
            {downloadLink(`/api/materials/${review.id}/export.docx`, m.downloadCorrected, true)}
            {downloadLink(`/api/materials/${review.id}/changes.txt`, m.downloadReport)}
            {downloadLink(`/api/materials/${review.id}/original.docx`, m.downloadOriginal)}
          </div>
          {review.acceptedGroups.length > (seg?.atGroupCount ?? 0) && (
            <div className="tf-actions" style={{ borderBlockStart: '1px solid var(--tf-border)', paddingBlockStart: 12 }}>
              <button
                className="tf-btn tf-btn--quiet"
                disabled={anyBusy}
                onClick={() => mutate('undo', 'export', `/api/materials/${review.id}/undo`, json('POST', { expectedRevision: review.revision }))}
              >
                <RotateCcw aria-hidden />
                {m.undo}
              </button>
            </div>
          )}
          {errors.export && (
            <Notice tone="fail" role="alert">
              {errors.export}
            </Notice>
          )}
        </section>
      </div>
    </div>
  );
}
