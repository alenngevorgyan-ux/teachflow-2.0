import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileText, Lock, RefreshCw, Upload, Wand2, XCircle } from 'lucide-react';
import type {
  Language,
  MaterialCheck,
  MaterialItem,
  MaterialItemResult,
  MaterialParagraph,
  MaterialReview,
  MaterialSuggestion,
  PinnedContext,
  Source,
  SourceConfirmationState,
} from '../../shared/types';
import { Badge } from '../components/Badge';
import { translations } from '../i18n/translations';

interface ReviewStatus {
  final: boolean;
  reasons: string[];
  counts: Record<string, number>;
}

interface MaterialView {
  review: MaterialReview;
  paragraphs: MaterialParagraph[];
  status: ReviewStatus;
  suggestionProblems?: Record<string, string[]>;
}

type RegistrySource = Source & { confirmationState: SourceConfirmationState; confirmationReason?: string };

interface Props {
  lang: Language;
  pinnedContext: PinnedContext;
}

type ItemState = 'checked' | 'needs_decision' | 'unchecked';

function itemState(result: MaterialItemResult | undefined, revision: string): ItemState {
  if (!result || result.stale || result.revision !== revision) return 'unchecked';
  if (result.checks.some((c) => c.status === 'fail' || c.status === 'needs_review')) return 'needs_decision';
  if (result.checks.some((c) => c.status === 'not_evaluated')) return 'unchecked';
  return 'checked';
}

const STATE_VARIANT: Record<ItemState, 'pass' | 'warn' | 'neutral'> = { checked: 'pass', needs_decision: 'warn', unchecked: 'neutral' };
const CHECK_VARIANT: Record<MaterialCheck['status'], 'pass' | 'fail' | 'warn' | 'neutral'> = {
  pass: 'pass',
  fail: 'fail',
  needs_review: 'warn',
  not_evaluated: 'neutral',
};

export const MaterialReviewPage: React.FC<Props> = ({ lang, pinnedContext }) => {
  const t = translations[lang].materialReview;

  const [materials, setMaterials] = useState<{ id: string; fileName: string; uploadedAt: string; status: ReviewStatus }[]>([]);
  const [view, setView] = useState<MaterialView | null>(null);
  const [sources, setSources] = useState<RegistrySource[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [subject, setSubject] = useState(pinnedContext.subject);
  const [grade, setGrade] = useState(String(pinnedContext.grade));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [programIds, setProgramIds] = useState<string[]>([]);
  const [factIds, setFactIds] = useState<string[]>([]);
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  const [keyDraft, setKeyDraft] = useState<Record<string, string>>({});

  const loadList = async () => {
    try {
      const r = await fetch('/api/materials');
      const d = await r.json();
      setMaterials(d.materials || []);
    } catch {
      /* the list is a convenience; errors show on actions */
    }
  };

  useEffect(() => {
    loadList();
    fetch('/api/sources')
      .then((r) => r.json())
      .then((d) => setSources(d.sources || []))
      .catch(() => setSources([]));
  }, []);

  useEffect(() => {
    if (!view) return;
    setProgramIds(view.review.selectedSources.filter((s) => s.purpose === 'program').map((s) => s.sourceId));
    setFactIds(view.review.selectedSources.filter((s) => s.purpose === 'fact').map((s) => s.sourceId));
  }, [view?.review.id, view?.review.selectedSources.length]);

  const call = async (label: string, url: string, init?: RequestInit) => {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch(url, init);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setView(data);
      loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const json = (method: string, body: unknown): RequestInit => ({
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const upload = async () => {
    if (!file || !subject.trim() || !grade.trim()) return;
    const form = new FormData();
    form.append('file', file);
    form.append('subject', subject.trim());
    form.append('grade', grade.trim());
    await call('upload', '/api/materials', { method: 'POST', body: form });
  };

  const review = view?.review;
  const seg = review?.segmentation;
  const paraById = useMemo(() => new Map((view?.paragraphs ?? []).map((p) => [p.id, p])), [view]);
  const itemOfPara = useMemo(() => {
    const m = new Map<string, MaterialItem>();
    for (const it of seg?.items ?? []) for (const id of [...it.stemParagraphIds, ...it.options.map((o) => o.paragraphId)]) m.set(id, it);
    return m;
  }, [seg]);
  const changedParas = useMemo(() => new Set((review?.acceptedGroups ?? []).flatMap((g) => g.patches.map((p) => p.paragraphId))), [review]);

  const eligible = (purpose: 'program' | 'fact') =>
    sources.filter(
      (s) =>
        review &&
        s.subject === review.subject &&
        s.grades.includes(review.grade) &&
        (purpose === 'program' ? s.docType === 'standard' || s.docType === 'subject_program' : s.role === 'FACT')
    );

  const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  // ------------------------------------------------------------ rendering

  const renderSourcePicker = (purpose: 'program' | 'fact') => {
    const list = eligible(purpose);
    const selected = purpose === 'program' ? programIds : factIds;
    const set = purpose === 'program' ? setProgramIds : setFactIds;
    return (
      <div className="space-y-1.5">
        <div className="font-semibold text-gray-800">{purpose === 'program' ? t.programSources : t.factSources}</div>
        {list.length === 0 && <div className="text-gray-600 italic">—</div>}
        {list.map((s) => {
          const ok = s.confirmationState === 'confirmed';
          return (
            <label key={s.id} className={`flex items-start gap-2 ${ok ? '' : 'opacity-60'}`} title={s.confirmationReason}>
              <input type="checkbox" disabled={!ok} checked={selected.includes(s.id)} onChange={() => toggle(selected, set, s.id)} className="mt-0.5" />
              <span>
                {s.title} <span className="font-mono text-gray-600">v{s.version}</span>{' '}
                <Badge size="sm" variant={ok ? 'pass' : 'neutral'}>
                  {t.confirmation[s.confirmationState]}
                </Badge>
                {s.isDemo && (
                  <Badge size="sm" variant="demo" className="ml-1">
                    DEMO
                  </Badge>
                )}
              </span>
            </label>
          );
        })}
      </div>
    );
  };

  const renderCheck = (c: MaterialCheck) => (
    <div key={c.checkId} className="border-t border-gray-100 pt-1.5 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-gray-800">{t.checkName[c.checkId]}</span>
        <Badge size="sm" variant={CHECK_VARIANT[c.status]}>
          {t.checkStatus[c.status]}
        </Badge>
      </div>
      <div className="text-gray-700">{c.detail}</div>
      {c.outcomeCodes?.length ? <div className="font-mono text-gray-600">{c.outcomeCodes.join(', ')}</div> : null}
      {c.evidence?.map((e) => (
        <details key={e.chunkId} className="text-gray-700">
          <summary className="cursor-pointer text-indigo-700">
            {t.evidence}: {e.chunkId} (v{e.sourceVersion}
            {e.page ? `, էջ ${e.page}` : ''})
          </summary>
          <blockquote className="border-l-2 border-indigo-200 pl-2 mt-1 whitespace-pre-wrap">{e.text}</blockquote>
        </details>
      ))}
      {c.model && <div className="text-[10px] font-mono text-gray-500">{c.model.providerId} / {c.model.modelId} · {c.model.promptVersion}</div>}
    </div>
  );

  const renderSuggestion = (s: MaterialSuggestion) => {
    const draft = edits[s.id] ?? {};
    const pending = s.status === 'proposed';
    return (
      <div key={s.id} className="rounded-lg border border-indigo-200 bg-indigo-50/40 p-2.5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="font-semibold text-indigo-900">{t.suggestion}</span>
          {s.status === 'accepted' && (
            <Badge size="sm" variant={s.recheck === 'done' ? 'pass' : 'warn'}>
              {s.recheck === 'done' ? t.accept : t.recheckPending}
              {s.editedByTeacher ? ` · ${t.edited}` : ''}
            </Badge>
          )}
          {s.status === 'rejected' && <Badge size="sm">{t.reject}</Badge>}
          {s.status === 'stale' && <Badge size="sm">{t.stale}</Badge>}
        </div>
        {s.group.patches.map((p) => (
          <div key={p.id} className="space-y-1">
            <div className="line-through text-rose-700 whitespace-pre-wrap">{p.expected || '∅'}</div>
            {pending ? (
              <input
                className="w-full border border-emerald-300 rounded px-2 py-1 bg-white"
                value={draft[p.id] ?? p.replacement}
                onChange={(e) => setEdits({ ...edits, [s.id]: { ...draft, [p.id]: e.target.value } })}
              />
            ) : (
              <div className="text-emerald-800 whitespace-pre-wrap">{p.replacement}</div>
            )}
          </div>
        ))}
        {s.keyChange && (
          <div>
            {t.newKey}: <strong>{s.keyChange.join(', ')}</strong>
          </div>
        )}
        <div>
          <span className="text-gray-600">{t.rationale}:</span> {s.rationale}
        </div>
        {s.evidence?.map((e) => (
          <blockquote key={e.chunkId + e.text} className="border-l-2 border-indigo-300 pl-2 text-gray-700">
            «{e.text}» <span className="font-mono text-[10px]">({e.chunkId})</span>
          </blockquote>
        ))}
        <div className="text-[10px] font-mono text-gray-500">{s.model.providerId} / {s.model.modelId}</div>
        {pending && (
          <div className="flex gap-2">
            <button
              disabled={!!busy}
              onClick={() =>
                call('decide', `/api/materials/${review!.id}/suggestions/${s.id}/decision`, json('POST', {
                  decision: 'accept',
                  expectedRevision: review!.revision,
                  replacements: Object.keys(draft).length ? draft : undefined,
                }))
              }
              className="px-2.5 py-1 rounded bg-emerald-600 text-white font-medium disabled:opacity-50"
            >
              {t.accept}
            </button>
            <button
              disabled={!!busy}
              onClick={() => call('decide', `/api/materials/${review!.id}/suggestions/${s.id}/decision`, json('POST', { decision: 'reject', expectedRevision: review!.revision }))}
              className="px-2.5 py-1 rounded border border-gray-300 bg-white disabled:opacity-50"
            >
              {t.reject}
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderItem = (item: MaterialItem) => {
    const result = review!.results.find((r) => r.itemId === item.id);
    const state = itemState(result, review!.revision);
    const key = review!.answerKey.find((k) => k.itemId === item.id);
    const suggestions = review!.suggestions.filter((s) => s.itemId === item.id && s.status !== 'stale');
    const problems = view?.suggestionProblems?.[item.id];
    const needsKey = (item.type === 'single_choice' || item.type === 'multiple_choice') && key?.origin !== 'document';
    return (
      <details key={item.id} open={state === 'needs_decision'} className="rounded-lg border border-gray-200 bg-white p-3 text-xs space-y-2">
        <summary className="cursor-pointer flex items-center justify-between gap-2">
          <span className="font-semibold text-gray-900">
            {t.question} {item.number}
          </span>
          <span className="flex items-center gap-1">
            {result?.stale && <Badge size="sm">{t.stale}</Badge>}
            <Badge size="sm" variant={STATE_VARIANT[state]}>
              {t.itemState[state]}
            </Badge>
          </span>
        </summary>
        <div className="text-gray-800 whitespace-pre-wrap">{item.stemParagraphIds.map((id) => paraById.get(id)?.text).join('\n')}</div>
        {item.options.length > 0 && (
          <div className="text-gray-700">
            {t.options}: {item.options.map((o) => o.label).join(', ')}
            {key && <> · ✔ {key.optionLabels.join(', ')} ({key.origin === 'teacher' ? '✍' : 'DOCX'})</>}
          </div>
        )}
        {needsKey && seg?.status === 'confirmed' && (
          <div className="flex items-center gap-2" title={t.keyNotEvidence}>
            <span>{t.setKey}:</span>
            <select value={keyDraft[item.id] ?? key?.optionLabels[0] ?? ''} onChange={(e) => setKeyDraft({ ...keyDraft, [item.id]: e.target.value })} className="border rounded px-1 py-0.5">
              <option value="">—</option>
              {item.options.map((o) => (
                <option key={o.label} value={o.label}>
                  {o.label}
                </option>
              ))}
            </select>
            <button
              disabled={!keyDraft[item.id] || !!busy}
              onClick={() => call('key', `/api/materials/${review!.id}/items/${item.id}/key`, json('PUT', { optionLabels: [keyDraft[item.id]] }))}
              className="px-2 py-0.5 rounded border border-gray-300 disabled:opacity-50"
            >
              {t.saveKey}
            </button>
          </div>
        )}
        {result?.checks.map(renderCheck)}
        {suggestions.map(renderSuggestion)}
        {problems?.length ? (
          <div className="text-amber-800 bg-amber-50 border border-amber-200 rounded p-2 space-y-0.5">
            {problems.map((p, i) => (
              <div key={i}>{p}</div>
            ))}
          </div>
        ) : null}
      </details>
    );
  };

  // ---------------------------------------------------------------- page

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <div className="border-b border-gray-200 pb-4">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          <Wand2 className="w-6 h-6 text-indigo-600" />
          {t.title}
        </h1>
        <p className="text-sm text-gray-700 mt-1">{t.subtitle}</p>
      </div>

      {error && (
        <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 text-rose-800 text-sm flex gap-2">
          <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="whitespace-pre-wrap">{error}</span>
        </div>
      )}

      {!review && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-3 text-xs">
            <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
              <Upload className="w-4 h-4" />
              {t.uploadTitle}
            </h2>
            <label className="block">
              <span className="font-medium text-gray-700">{t.fileLabel} *</span>
              <input type="file" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block mt-1" />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label>
                <span className="font-medium text-gray-700">{translations[lang].common.subject} *</span>
                <input value={subject} onChange={(e) => setSubject(e.target.value)} className="w-full border border-gray-300 rounded px-2 py-1 mt-1" />
              </label>
              <label>
                <span className="font-medium text-gray-700">{translations[lang].common.grade} *</span>
                <input value={grade} onChange={(e) => setGrade(e.target.value)} inputMode="numeric" className="w-full border border-gray-300 rounded px-2 py-1 mt-1" />
              </label>
            </div>
            <p className="text-gray-600">{t.uploadHint}</p>
            <button disabled={!file || !subject.trim() || !grade.trim() || !!busy} onClick={upload} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-medium disabled:opacity-50">
              {busy === 'upload' ? t.working : t.uploadBtn}
            </button>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5 space-y-2 text-xs">
            <h2 className="font-semibold text-gray-900 text-sm">{t.previous}</h2>
            {materials.length === 0 && <div className="text-gray-600">—</div>}
            {materials.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-2 border-t border-gray-100 pt-1.5">
                <span className="truncate">
                  <FileText className="w-3.5 h-3.5 inline mr-1" />
                  {m.fileName} <span className="text-gray-500">{m.uploadedAt.slice(0, 10)}</span>
                </span>
                <span className="flex items-center gap-2 shrink-0">
                  <Badge size="sm" variant={m.status.final ? 'pass' : 'warn'}>
                    {m.status.final ? t.itemState.checked : 'draft'}
                  </Badge>
                  <button onClick={() => call('open', `/api/materials/${m.id}`)} className="text-indigo-700 underline">
                    {t.open}
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {review && view && (
        <>
          {/* Pinned context */}
          <div className="sticky top-16 z-30 bg-white/95 backdrop-blur border border-gray-200 rounded-xl p-3 text-xs flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span className="font-semibold text-gray-900">
              <FileText className="w-3.5 h-3.5 inline mr-1" />
              {review.fileName}
            </span>
            <span>
              {review.subject}, {review.grade}
            </span>
            <span className="font-mono text-gray-600">
              {t.revision}: {review.revision}
            </span>
            <span className="text-gray-700">
              {review.selectedSources.map((s) => {
                const src = sources.find((x) => x.id === s.sourceId);
                return `${src?.title ?? s.sourceId} v${s.version}`;
              }).join(' · ') || '—'}
            </span>
            <Badge variant={view.status.final ? 'pass' : 'warn'}>{view.status.final ? t.finalNote : t.draftWarning}</Badge>
            <button onClick={() => setView(null)} className="ml-auto text-gray-600 underline">
              ✕
            </button>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap gap-2 text-xs">
            <button disabled={!!busy} onClick={() => call('segment', `/api/materials/${review.id}/segment`, json('POST', {}))} className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white disabled:opacity-50">
              {t.proposeSplit}
            </button>
            <button disabled={!!busy || !seg || seg.status === 'confirmed'} onClick={() => call('confirm', `/api/materials/${review.id}/segmentation/confirm`, json('POST', { expectedRevision: review.revision }))} className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white disabled:opacity-50">
              {t.confirmSplit}
            </button>
            <button disabled={!!busy || seg?.status !== 'confirmed'} onClick={() => call('check', `/api/materials/${review.id}/check`, json('POST', {}))} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white disabled:opacity-50 flex items-center gap-1">
              <RefreshCw className="w-3.5 h-3.5" />
              {t.runChecks}
            </button>
            <button disabled={!!busy || seg?.status !== 'confirmed'} onClick={() => call('suggest', `/api/materials/${review.id}/suggest`, json('POST', {}))} className="px-3 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-800 disabled:opacity-50 flex items-center gap-1">
              <Wand2 className="w-3.5 h-3.5" />
              {t.suggestFixes}
            </button>
            <a href={`/api/materials/${review.id}/export.docx`} className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white flex items-center gap-1">
              <Download className="w-3.5 h-3.5" />
              {t.downloadDocx}
            </a>
            <a href={`/api/materials/${review.id}/changes.txt`} className="px-3 py-1.5 rounded-lg border border-emerald-300 text-emerald-800 bg-white flex items-center gap-1">
              <Download className="w-3.5 h-3.5" />
              {t.downloadChanges}
            </a>
            {busy && <span className="text-gray-600 self-center">{t.working}</span>}
          </div>
          {!view.status.final && (
            <div className="text-xs p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 space-y-0.5">
              <div className="font-semibold flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                {t.draftWarning}
              </div>
              {view.status.reasons.map((r, i) => (
                <div key={i}>• {r}</div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left: sources + preservation */}
            <div className="lg:col-span-3 space-y-4 text-xs">
              <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
                <div className="font-semibold text-gray-900 text-sm">{t.stepSources}</div>
                <p className="text-gray-600">{t.onlyConfirmed}</p>
                {eligible('program').every((s) => s.confirmationState !== 'confirmed') && eligible('fact').every((s) => s.confirmationState !== 'confirmed') && (
                  <p className="text-amber-800">{t.noSourcesYet}</p>
                )}
                {renderSourcePicker('program')}
                {renderSourcePicker('fact')}
                <button disabled={!!busy} onClick={() => call('sources', `/api/materials/${review.id}/sources`, json('PUT', { programSourceIds: programIds, factSourceIds: factIds }))} className="px-3 py-1 rounded border border-gray-300 disabled:opacity-50">
                  {t.saveSources}
                </button>
              </div>
              {(review.preservation.length > 0 || review.privacy.uncheckable.length > 0) && (
                <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
                  <div className="font-semibold text-gray-900 flex items-center gap-1">
                    <Lock className="w-3.5 h-3.5" />
                    {t.preservationTitle}
                  </div>
                  {review.preservation.map((p) => (
                    <div key={p.kind} className="text-gray-700">
                      • {p.note} ({p.count}){!p.textChecked && <span className="text-amber-800"> — {t.notPrivacyChecked}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Center: paragraph preview */}
            <div className="lg:col-span-5 bg-white rounded-xl border border-gray-200 p-4 space-y-1 text-sm">
              <p className="text-[11px] text-gray-600 italic mb-2">{t.previewNote}</p>
              {view.paragraphs.map((p) => {
                if (p.text.trim() === '') return null;
                const item = itemOfPara.get(p.id);
                const isKey = seg?.answerKeyParagraphIds.includes(p.id);
                const state = item ? itemState(review.results.find((r) => r.itemId === item.id), review.revision) : undefined;
                return (
                  <div
                    key={p.id}
                    title={p.editable ? p.id : `${t.locked}: ${p.lockReasons.join(', ')}`}
                    className={`px-2 py-0.5 rounded whitespace-pre-wrap ${p.location === 'table' ? 'border-l-2 border-gray-300 ml-2' : ''} ${
                      !p.editable ? 'text-gray-500 bg-gray-50' : ''
                    } ${state === 'needs_decision' ? 'bg-amber-50' : ''} ${isKey ? 'bg-sky-50' : ''} ${changedParas.has(p.id) ? 'ring-1 ring-emerald-300' : ''}`}
                  >
                    {p.label && <span className="text-gray-500 mr-1">{p.label}</span>}
                    {p.text}
                    {!p.editable && <Lock className="w-3 h-3 inline ml-1 text-gray-400" />}
                  </div>
                );
              })}
            </div>

            {/* Right: questions that need attention */}
            <div className="lg:col-span-4 space-y-3">
              {seg && (
                <div className="text-xs p-3 rounded-lg border border-gray-200 bg-white space-y-1">
                  <div className="font-semibold flex items-center gap-1">
                    {seg.status === 'confirmed' ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> : <AlertTriangle className="w-3.5 h-3.5 text-amber-600" />}
                    {seg.status === 'confirmed' ? t.splitConfirmed : seg.status === 'needs_reconfirmation' ? t.splitNeedsReconfirm : t.splitProposed}
                  </div>
                  <div className="text-[10px] font-mono text-gray-500">
                    {seg.model.providerId} / {seg.model.modelId} · {seg.model.promptVersion}
                  </div>
                  {seg.problems.length > 0 && (
                    <details>
                      <summary className="cursor-pointer text-amber-800">
                        {t.splitProblems} ({seg.problems.length})
                      </summary>
                      {seg.problems.map((p, i) => (
                        <div key={i} className="text-gray-700">
                          – {p}
                        </div>
                      ))}
                    </details>
                  )}
                </div>
              )}
              {!seg?.items.length && <div className="text-xs text-gray-600">{t.noItems}</div>}
              {seg?.items.map(renderItem)}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
