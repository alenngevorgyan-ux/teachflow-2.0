import React, { useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  BookMarked,
  BookOpen,
  Calendar,
  CheckSquare,
  Cpu,
  FileCheck2,
  FileText,
  GitCompare,
  Home,
  Menu,
  Search,
  Shield,
  Sliders,
  Sparkles,
  TrendingUp,
  X,
} from 'lucide-react';
import type { Language, PinnedContext, Role } from '../../../shared/types';
import { translations } from '../../i18n/translations';

interface NavItem {
  id: string;
  label: string;
  icon: React.ComponentType<{ 'aria-hidden'?: boolean }>;
  roles: Role[];
}

interface Props {
  lang: Language;
  onLangChange: (l: Language) => void;
  role: Role;
  onRoleChange: (r: Role) => void;
  currentTab: string;
  onTabChange: (tab: string) => void;
  pinnedContext: PinnedContext;
  onContextChange: (c: Partial<PinnedContext>) => void;
  policyVersion?: string;
  onResetDemo: () => void;
  fixtureMode: boolean;
  navOpen: boolean;
  onNavOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

const ALL: Role[] = ['teacher', 'director', 'reviewer', 'methodologist', 'admin'];

export function AppShell(p: Props) {
  const t = translations[p.lang];
  const s = t.shell;
  const menuButton = useRef<HTMLButtonElement>(null);
  // Wide screens show the context inline; narrow ones start with it collapsed.
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 900px)').matches);
  const [, setContextOpen] = useState(wide);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 900px)');
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const sidebar = useRef<HTMLElement>(null);

  // Access rules are the existing ones (per role); the grouping is new.
  const groups: { title: string; items: NavItem[] }[] = [
    {
      title: s.groupMain,
      items: [
        { id: 'home', label: s.home, icon: Home, roles: ALL },
        { id: 'materialReview', label: s.materials, icon: FileCheck2, roles: ['teacher', 'methodologist', 'admin'] },
        { id: 'workspace', label: s.workspace, icon: Sparkles, roles: ALL },
        { id: 'thematicPlans', label: t.nav.thematicPlans, icon: Calendar, roles: ALL },
        { id: 'reports', label: t.nav.reports, icon: FileText, roles: ALL },
        { id: 'registry', label: t.nav.registry, icon: BookOpen, roles: ['methodologist', 'admin', 'reviewer'] },
      ],
    },
    {
      title: s.groupTools,
      items: [
        { id: 'autoGrading', label: t.nav.autoGrading, icon: CheckSquare, roles: ['teacher', 'director', 'methodologist', 'admin'] },
        { id: 'validateMaterial', label: t.nav.validateMaterial, icon: Search, roles: ['teacher', 'methodologist', 'admin'] },
        { id: 'glossary', label: t.nav.glossary, icon: BookMarked, roles: ['teacher', 'methodologist', 'reviewer', 'admin'] },
      ],
    },
    {
      title: s.groupAdmin,
      items: [
        { id: 'aiReview', label: t.nav.aiReview, icon: FileCheck2, roles: ['director', 'reviewer', 'methodologist', 'admin'] },
        { id: 'dashboards', label: t.nav.dashboards, icon: BarChart3, roles: ['director', 'reviewer', 'methodologist', 'admin'] },
        { id: 'rules', label: t.nav.rules, icon: Sliders, roles: ['methodologist', 'admin'] },
        { id: 'armenianEval', label: t.nav.armenianEval, icon: Cpu, roles: ['admin', 'methodologist'] },
        { id: 'compare', label: t.nav.compare, icon: GitCompare, roles: ['admin', 'methodologist'] },
        { id: 'regression', label: t.nav.regression, icon: TrendingUp, roles: ['admin', 'methodologist'] },
        { id: 'aboutData', label: t.nav.aboutData, icon: Shield, roles: ALL },
      ],
    },
  ];

  // Drawer: Escape closes it and focus returns to the menu button.
  useEffect(() => {
    if (!p.navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        p.onNavOpenChange(false);
        menuButton.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    sidebar.current?.querySelector<HTMLElement>('button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [p.navOpen]);

  const go = (id: string) => {
    p.onTabChange(id);
    if (p.navOpen) {
      p.onNavOpenChange(false);
      menuButton.current?.focus();
    }
  };

  return (
    <div className="tf-shell" data-nav-open={p.navOpen}>
      <a className="tf-skip" href="#tf-content">
        {s.skip}
      </a>
      {p.navOpen && <button className="tf-scrim" aria-label={s.closeMenu} onClick={() => p.onNavOpenChange(false)} />}
      <aside className="tf-sidebar" ref={sidebar} id="tf-sidebar" aria-label={s.menu}>
        <div className="tf-wordmark">
          TeachFlow <small>{s.demoData}</small>
        </div>
        {groups.map((g) => {
          const visible = g.items.filter((i) => i.roles.includes(p.role));
          if (!visible.length) return null;
          return (
            <nav key={g.title} className="tf-nav-group" aria-label={g.title}>
              <h2>{g.title}</h2>
              {visible.map((i) => {
                const Icon = i.icon;
                const current = p.currentTab === i.id || (i.id === 'materialReview' && p.currentTab.startsWith('materialReview'));
                return (
                  <button key={i.id} className="tf-nav-item" aria-current={current ? 'page' : undefined} onClick={() => go(i.id)}>
                    <Icon aria-hidden />
                    {i.label}
                  </button>
                );
              })}
            </nav>
          );
        })}
        <div className="tf-sidebar-foot">
          <label className="tf-field">
            <span>{s.role}</span>
            <select className="tf-select" value={p.role} onChange={(e) => p.onRoleChange(e.target.value as Role)}>
              {ALL.map((r) => (
                <option key={r} value={r}>
                  {t.roles[r]}
                </option>
              ))}
            </select>
          </label>
          <div className="tf-segmented" role="group" aria-label={s.language}>
            {(['hy', 'ru', 'en'] as Language[]).map((l) => (
              <button key={l} aria-pressed={p.lang === l} lang={l} onClick={() => p.onLangChange(l)}>
                {l === 'hy' ? 'Հայ' : l === 'ru' ? 'Рус' : 'Eng'}
              </button>
            ))}
          </div>
          {p.policyVersion && (
            <span>
              {s.policy}: <code>{p.policyVersion}</code>
            </span>
          )}
          <button className="tf-btn tf-btn--small" onClick={p.onResetDemo}>
            {s.resetDemo}
          </button>
          <span>{s.notOfficial}</span>
        </div>
      </aside>

      <div className="tf-main">
        {p.fixtureMode && (
          <div className="tf-fixture-banner" role="note">
            {s.fixtureBanner}
          </div>
        )}
        <div className="tf-topbar">
          <button
            ref={menuButton}
            className="tf-btn tf-btn--small tf-menu-button"
            aria-expanded={p.navOpen}
            aria-controls="tf-sidebar"
            onClick={() => p.onNavOpenChange(!p.navOpen)}
          >
            {p.navOpen ? <X aria-hidden /> : <Menu aria-hidden />}
            {s.menu}
          </button>
          <details className="tf-context-details" open={wide} onToggle={(e) => setContextOpen((e.target as HTMLDetailsElement).open)}>
            <summary>
              {s.contextLabel}: {p.pinnedContext.subject}, {p.pinnedContext.grade}
            </summary>
          <div className="tf-context" role="group" aria-label={s.contextLabel}>
            <label>
              {s.subject}
              <select value={p.pinnedContext.subject} onChange={(e) => p.onContextChange({ subject: e.target.value })}>
                <option value="Հայոց պատմություն">Հայոց պատմություն</option>
                <option value="Բնագիտություն">Բնագիտություն</option>
              </select>
            </label>
            <label>
              {s.grade}
              <select value={p.pinnedContext.grade} onChange={(e) => p.onContextChange({ grade: Number(e.target.value) })}>
                <option value={5}>5</option>
                <option value={7}>7</option>
              </select>
            </label>
            <label>
              {s.school}
              <select value={p.pinnedContext.schoolId} onChange={(e) => p.onContextChange({ schoolId: e.target.value })}>
                <option value="sch-1">Դպրոց Ա ({s.demoData})</option>
                <option value="sch-2">Դպրոց Բ ({s.demoData})</option>
                <option value="sch-3">Դպրոց Գ ({s.demoData})</option>
              </select>
            </label>
            <label>
              {s.term}
              <select value={p.pinnedContext.term} onChange={(e) => p.onContextChange({ term: Number(e.target.value) as 1 | 2 })}>
                <option value={1}>{s.termOption.replace('{n}', '1')}</option>
                <option value={2}>{s.termOption.replace('{n}', '2')}</option>
              </select>
            </label>
          </div>
          </details>
        </div>
        <main id="tf-content" className="tf-content" tabIndex={-1}>
          {p.children}
        </main>
      </div>
    </div>
  );
}
