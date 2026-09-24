import React, { useEffect, useId, useRef, useState } from 'react';
import { FileText, Upload } from 'lucide-react';
import type { Language, PinnedContext } from '../../../shared/types';
import { EmptyState, Field, Notice, PageHeader, StatusBadge } from '../../components/ui';
import { translations } from '../../i18n/translations';
import { ApiError, MaterialSummary, MaterialView, api } from './api';

interface Props {
  lang: Language;
  pinnedContext: PinnedContext;
  onOpen: (id: string) => void;
}

type ListState = { kind: 'loading' } | { kind: 'failed'; message: string } | { kind: 'ready'; items: MaterialSummary[] };

export function MaterialsList({ lang, pinnedContext, onOpen }: Props) {
  const m = translations[lang].materialReview;
  const [list, setList] = useState<ListState>({ kind: 'loading' });
  const [query, setQuery] = useState('');
  const [stateFilter, setStateFilter] = useState<'all' | 'draft' | 'final'>('all');

  const [file, setFile] = useState<File | null>(null);
  const [subject, setSubject] = useState(pinnedContext.subject);
  const [grade, setGrade] = useState(String(pinnedContext.grade));
  const [over, setOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);
  const [declarationParts, setDeclarationParts] = useState<string[] | null>(null);
  const [declared, setDeclared] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  const load = () => {
    setList({ kind: 'loading' });
    api<{ materials: MaterialSummary[] }>('/api/materials')
      .then((d) => setList({ kind: 'ready', items: [...d.materials].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)) }))
      .catch((e: unknown) => setList({ kind: 'failed', message: e instanceof Error ? e.message : String(e) }));
  };
  useEffect(load, []);

  const pick = (f: File | null) => {
    setFile(f);
    setRejection(null);
    setDeclarationParts(null);
    setDeclared(false);
  };

  const upload = async () => {
    if (!file) return;
    setUploading(true);
    setRejection(null);
    const form = new FormData();
    form.append('file', file);
    form.append('subject', subject.trim());
    form.append('grade', grade.trim());
    if (declared) form.append('declaredNoStudentData', 'true');
    try {
      const view = await api<MaterialView>('/api/materials', { method: 'POST', body: form });
      onOpen(view.review.id);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'declaration_required') {
        setDeclarationParts((e.body?.parts as string[]) ?? []);
      } else {
        setRejection(e instanceof ApiError && e.status === 0 ? m.network : e instanceof Error ? e.message : String(e));
      }
    } finally {
      setUploading(false);
    }
  };

  const fmt = (iso: string) => new Date(iso).toLocaleDateString(lang === 'hy' ? 'hy-AM' : lang === 'ru' ? 'ru-RU' : 'en-GB');
  const visible =
    list.kind === 'ready'
      ? list.items.filter(
          (i) =>
            i.fileName.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) &&
            (stateFilter === 'all' || (stateFilter === 'final') === i.status.final)
        )
      : [];

  return (
    <div className="tf-page">
      <PageHeader eyebrow={m.eyebrow} title={m.title} description={m.subtitle} />

      <section className="tf-section" aria-labelledby="upload-title">
        <h2 id="upload-title">{m.newMaterial}</h2>
        <div
          className="tf-dropzone"
          data-over={over}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            pick(e.dataTransfer.files?.[0] ?? null);
          }}
        >
          <Upload aria-hidden style={{ inlineSize: 28, blockSize: 28, color: 'var(--tf-brand)' }} />
          <strong>{m.dropTitle}</strong>
          <span className="tf-meta">{m.dropOr}</span>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="tf-sr-only"
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
          />
          <label htmlFor={inputId} className="tf-btn">
            {m.chooseFile}
          </label>
          <span className="tf-meta">{m.dropHint}</span>
          {file && (
            <span style={{ overflowWrap: 'anywhere' }}>
              {m.fileSelected}: <strong>{file.name}</strong>
            </span>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))', gap: 12 }}>
          <Field label={m.subject}>
            <input className="tf-input" value={subject} onChange={(e) => setSubject(e.target.value)} required />
          </Field>
          <Field label={m.grade}>
            <input className="tf-input" value={grade} onChange={(e) => setGrade(e.target.value)} inputMode="numeric" required />
          </Field>
        </div>
        {declarationParts && (
          <Notice tone="warn" title={m.declarationTitle} role="alert">
            <p style={{ margin: '4px 0' }}>{m.declarationText}</p>
            <ul>
              {declarationParts.map((p) => (
                <li key={p}>
                  <code>{p}</code>
                </li>
              ))}
            </ul>
            <label className="tf-check">
              <input type="checkbox" checked={declared} onChange={(e) => setDeclared(e.target.checked)} />
              <span>{m.declarationCheckbox}</span>
            </label>
          </Notice>
        )}
        {rejection && (
          <Notice tone="fail" title={m.rejectedTitle} role="alert">
            {rejection}
          </Notice>
        )}
        <div className="tf-actions">
          <button
            className="tf-btn tf-btn--primary"
            disabled={!file || !subject.trim() || !grade.trim() || uploading || (declarationParts !== null && !declared)}
            onClick={upload}
          >
            {uploading ? m.uploading : m.uploadBtn}
          </button>
        </div>
      </section>

      <section className="tf-section" aria-labelledby="list-title">
        <h2 id="list-title">{m.title}</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', gap: 12 }}>
          <Field label={m.listSearch}>
            <input className="tf-input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
          </Field>
          <Field label={m.listFilter}>
            <select className="tf-select" value={stateFilter} onChange={(e) => setStateFilter(e.target.value as 'all' | 'draft' | 'final')}>
              <option value="all">{m.filterAllStates}</option>
              <option value="draft">{m.filterDraft}</option>
              <option value="final">{m.filterFinal}</option>
            </select>
          </Field>
        </div>
        {list.kind === 'loading' && <p className="tf-meta">{m.running}</p>}
        {list.kind === 'failed' && (
          <Notice tone="fail" title={m.listLoadFailed} role="alert">
            {list.message}{' '}
            <button className="tf-btn tf-btn--small" onClick={load}>
              {m.retryFailed}
            </button>
          </Notice>
        )}
        {list.kind === 'ready' && list.items.length === 0 && <EmptyState>{m.emptyList}</EmptyState>}
        {list.kind === 'ready' && list.items.length > 0 && visible.length === 0 && <EmptyState>{m.filterNothing}</EmptyState>}
        {visible.length > 0 && (
          <ul className="tf-list">
            {visible.map((i) => (
              <li key={i.id}>
                <span style={{ minInlineSize: 0, overflowWrap: 'anywhere' }}>
                  <FileText aria-hidden style={{ inlineSize: 18, blockSize: 18, verticalAlign: '-3px', marginInlineEnd: 6, color: 'var(--tf-muted)' }} />
                  <strong>{i.fileName}</strong>
                  <span className="tf-meta" style={{ display: 'block' }}>
                    {i.subject}, {i.grade} · {m.uploadedAt} {fmt(i.uploadedAt)} ·{' '}
                    {i.questions === null ? m.notSplitYet : `${i.questions} ${m.questionsCount}`} · {i.acceptedChanges} {m.changesCount}
                  </span>
                </span>
                <span className="tf-actions">
                  <StatusBadge tone={i.status.final ? 'pass' : 'warn'}>{i.status.final ? m.final : m.draft}</StatusBadge>
                  <button className="tf-btn tf-btn--small" onClick={() => onOpen(i.id)}>
                    {m.open}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
