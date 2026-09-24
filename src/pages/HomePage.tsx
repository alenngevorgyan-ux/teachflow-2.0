import React, { useEffect, useState } from 'react';
import type { Language, Role } from '../../shared/types';
import { EmptyState, Notice, PageHeader, StatusBadge } from '../components/ui';
import { translations } from '../i18n/translations';

interface RecentMaterial {
  id: string;
  fileName: string;
  uploadedAt: string;
  questions: number | null;
  status: { final: boolean };
}

interface Props {
  lang: Language;
  role: Role;
  onNavigate: (tab: string) => void;
  onOpenMaterial: (id: string) => void;
}

// Three real destinations and real recent work only: no activity feed,
// statistics or names are invented here.
export function HomePage({ lang, role, onNavigate, onOpenMaterial }: Props) {
  const t = translations[lang];
  const h = t.home;
  const m = t.materialReview;
  const [recent, setRecent] = useState<RecentMaterial[] | null>(null);
  const [failed, setFailed] = useState(false);
  const canReview = role === 'teacher' || role === 'methodologist' || role === 'admin';

  useEffect(() => {
    if (!canReview) return;
    fetch('/api/materials')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
      .then((d) => setRecent([...(d.materials as RecentMaterial[])].sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt)).slice(0, 5)))
      .catch(() => setFailed(true));
  }, [canReview]);

  const fmt = (iso: string) => new Date(iso).toLocaleDateString(lang === 'hy' ? 'hy-AM' : lang === 'ru' ? 'ru-RU' : 'en-GB');

  return (
    <div className="tf-page">
      <PageHeader title={h.title} description={h.subtitle} />
      <div className="tf-home-actions">
        {canReview && (
          <button className="tf-home-action" data-primary="true" onClick={() => onNavigate('materialReview')}>
            <strong>{h.checkTitle}</strong>
            <span>{h.checkText}</span>
          </button>
        )}
        <button className="tf-home-action" onClick={() => onNavigate('workspace')}>
          <strong>{h.prepareTitle}</strong>
          <span>{h.prepareText}</span>
        </button>
        <button className="tf-home-action" onClick={() => onNavigate('reports')}>
          <strong>{h.reportTitle}</strong>
          <span>{h.reportText}</span>
        </button>
      </div>

      {canReview && (
        <section className="tf-section" aria-labelledby="home-recent">
          <div className="tf-page-header">
            <h2 id="home-recent" className="tf-section-title">
              {h.recent}
            </h2>
            <button className="tf-btn tf-btn--quiet tf-btn--small" onClick={() => onNavigate('materialReview')}>
              {h.openAll}
            </button>
          </div>
          {failed && <Notice tone="fail">{h.recentFailed}</Notice>}
          {!failed && recent && recent.length === 0 && <EmptyState>{h.recentEmpty}</EmptyState>}
          {!failed && recent && recent.length > 0 && (
            <ul className="tf-list">
              {recent.map((r) => (
                <li key={r.id}>
                  <span style={{ minInlineSize: 0, overflowWrap: 'anywhere' }}>
                    <strong>{r.fileName}</strong>
                    <span className="tf-meta" style={{ display: 'block' }}>
                      {m.uploadedAt} {fmt(r.uploadedAt)} · {r.questions === null ? m.notSplitYet : `${r.questions} ${m.questionsCount}`}
                    </span>
                  </span>
                  <span className="tf-actions">
                    <StatusBadge tone={r.status.final ? 'pass' : 'warn'}>{r.status.final ? m.final : m.draft}</StatusBadge>
                    <button className="tf-btn tf-btn--small" onClick={() => onOpenMaterial(r.id)}>
                      {m.open}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
