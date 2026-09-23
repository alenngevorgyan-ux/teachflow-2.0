import React from 'react';
import {
  BookOpen,
  CheckSquare,
  Sparkles,
  Search,
  Sliders,
  GitCompare,
  TrendingUp,
  Inbox,
  Shield,
  Layers,
  Globe,
  UserCheck,
  Calendar,
  FileText,
  FileCheck2,
  BarChart3,
  BookMarked,
  Cpu,
  Pin,
  Building2,
  GraduationCap,
} from 'lucide-react';
import { Language, PinnedContext, Role } from '../../shared/types';
import { translations } from '../i18n/translations';

interface HeaderProps {
  currentTab: string;
  onTabChange: (tab: string) => void;
  currentRole: Role;
  onRoleChange: (role: Role) => void;
  lang: Language;
  onLangChange: (lang: Language) => void;
  pinnedContext: PinnedContext;
  onContextChange: (ctx: Partial<PinnedContext>) => void;
  policyVersion?: string;
  onResetDemo?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  onTabChange,
  currentRole,
  onRoleChange,
  lang,
  onLangChange,
  pinnedContext,
  onContextChange,
  policyVersion,
  onResetDemo,
}) => {
  const t = translations[lang];

  // All navigation tabs with role-based visibility
  const allTabs = [
    { id: 'workspace', label: t.nav.workspace, icon: Sparkles, roles: ['teacher', 'director', 'reviewer', 'methodologist', 'admin'] },
    { id: 'thematicPlans', label: t.nav.thematicPlans, icon: Calendar, roles: ['teacher', 'director', 'reviewer', 'methodologist', 'admin'] },
    { id: 'autoGrading', label: t.nav.autoGrading, icon: CheckSquare, roles: ['teacher', 'director', 'methodologist', 'admin'] },
    { id: 'reports', label: t.nav.reports, icon: FileText, roles: ['teacher', 'director', 'reviewer', 'methodologist', 'admin'] },
    { id: 'aiReview', label: t.nav.aiReview, icon: FileCheck2, roles: ['director', 'reviewer', 'methodologist', 'admin'] },
    { id: 'dashboards', label: t.nav.dashboards, icon: BarChart3, roles: ['director', 'reviewer', 'methodologist', 'admin'] },
    { id: 'registry', label: t.nav.registry, icon: BookOpen, roles: ['methodologist', 'admin', 'reviewer'] },
    { id: 'rules', label: t.nav.rules, icon: Sliders, roles: ['methodologist', 'admin'] },
    { id: 'glossary', label: t.nav.glossary, icon: BookMarked, roles: ['teacher', 'methodologist', 'reviewer', 'admin'] },
    { id: 'armenianEval', label: t.nav.armenianEval, icon: Cpu, roles: ['admin', 'methodologist'] },
    { id: 'validateMaterial', label: 'Ստուգել նյութը', icon: Search, roles: ['teacher', 'methodologist', 'admin'] },
    { id: 'compare', label: 'AI vs TeachFlow', icon: GitCompare, roles: ['admin', 'methodologist'] },
    { id: 'regression', label: 'Ռեգրեսիա', icon: TrendingUp, roles: ['admin', 'methodologist'] },
    { id: 'aboutData', label: t.nav.aboutData, icon: Shield, roles: ['teacher', 'director', 'reviewer', 'methodologist', 'admin'] },
  ];

  const visibleTabs = allTabs.filter((tab) => tab.roles.includes(currentRole));

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-xs">
      {/* Top Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Product Name */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-700 via-indigo-600 to-sky-500 text-white flex items-center justify-center font-bold text-lg shadow-sm">
              <Layers className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-gray-900 text-xl tracking-tight">
                  TeachFlow <span className="text-indigo-600">3.0</span>
                </span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 font-semibold border border-amber-200">
                  {t.common.demoBadge}
                </span>
              </div>
              <span className="text-[11px] text-gray-700 hidden sm:block">
                {t.tagline}
              </span>
            </div>
          </div>

          {/* Right Controls: Role switch, Policy Hash, Language Toggle */}
          <div className="flex items-center gap-3">
            {/* Policy Hash indicator */}
            {policyVersion && (
              <div className="hidden xl:flex items-center gap-1.5 px-2.5 py-1 bg-gray-50 border border-gray-200 rounded-md text-xs text-gray-600">
                <span className="text-gray-700 font-mono">Policy:</span>
                <span className="font-mono font-medium text-gray-800">{policyVersion}</span>
              </div>
            )}

            {/* Role Switcher */}
            <div className="flex items-center bg-gray-100 p-1 rounded-lg border border-gray-200 text-xs">
              <UserCheck className="w-3.5 h-3.5 text-gray-700 ml-1 mr-1" />
              {(['teacher', 'director', 'reviewer', 'methodologist', 'admin'] as Role[]).map((r) => (
                <button
                  key={r}
                  onClick={() => onRoleChange(r)}
                  className={`px-2 py-1 rounded-md font-medium transition-colors ${
                    currentRole === r
                      ? 'bg-white text-indigo-700 shadow-xs font-semibold'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {t.roles[r]}
                </button>
              ))}
            </div>

            {/* Language Switcher */}
            <div className="flex items-center bg-gray-100 p-1 rounded-lg border border-gray-200 text-xs">
              <Globe className="w-3.5 h-3.5 text-gray-700 ml-1 mr-1" />
              {(['hy', 'ru', 'en'] as Language[]).map((l) => (
                <button
                  key={l}
                  onClick={() => onLangChange(l)}
                  className={`px-2 py-1 rounded-md font-medium uppercase transition-colors ${
                    lang === l
                      ? 'bg-white text-gray-900 shadow-xs font-bold'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>

            {/* Reset Demo Data Button */}
            {onResetDemo && (
              <button
                onClick={onResetDemo}
                title="Վերակայել ցուցադրական սինթետիկ տվյալները"
                className="text-xs px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-md border border-gray-300 font-medium transition-colors"
              >
                Reset Demo
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Pinned Context Bar (Subject, Grade, Program Version, Year, School, Term) */}
      <div className="bg-indigo-50/60 border-t border-b border-indigo-100/80 px-4 sm:px-6 lg:px-8 py-1.5">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-indigo-900 font-medium">
            <Pin className="w-3.5 h-3.5 text-indigo-600" />
            <span className="font-semibold">{t.common.pinnedContext}:</span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Subject Selector */}
            <div className="flex items-center gap-1.5 bg-white px-2 py-0.5 rounded border border-indigo-200 shadow-2xs">
              <BookOpen className="w-3 h-3 text-indigo-600" />
              <span className="text-gray-700 text-[11px]">{t.common.subject}:</span>
              <select
                value={pinnedContext.subject}
                onChange={(e) => onContextChange({ subject: e.target.value })}
                className="bg-transparent font-medium text-gray-900 focus:outline-hidden text-xs cursor-pointer"
              >
                <option value="Հայոց պատմություն">Հայոց պատմություն</option>
                <option value="Բնագիտություն">Բնագիտություն</option>
              </select>
            </div>

            {/* Grade Selector */}
            <div className="flex items-center gap-1.5 bg-white px-2 py-0.5 rounded border border-indigo-200 shadow-2xs">
              <GraduationCap className="w-3 h-3 text-indigo-600" />
              <span className="text-gray-700 text-[11px]">{t.common.grade}:</span>
              <select
                value={pinnedContext.grade}
                onChange={(e) => onContextChange({ grade: Number(e.target.value) })}
                className="bg-transparent font-medium text-gray-900 focus:outline-hidden text-xs cursor-pointer"
              >
                <option value={7}>7-րդ դասարան</option>
                <option value={5}>5-րդ դասարան</option>
              </select>
            </div>

            {/* Program Version */}
            <div className="flex items-center gap-1.5 bg-white px-2 py-0.5 rounded border border-indigo-200 shadow-2xs">
              <span className="text-gray-700 text-[11px]">{t.common.programVersion}:</span>
              <span className="font-semibold text-indigo-700">{pinnedContext.programVersion}</span>
            </div>

            {/* School Selector */}
            <div className="flex items-center gap-1.5 bg-white px-2 py-0.5 rounded border border-indigo-200 shadow-2xs">
              <Building2 className="w-3 h-3 text-indigo-600" />
              <span className="text-gray-700 text-[11px]">{t.common.school}:</span>
              <select
                value={pinnedContext.schoolId}
                onChange={(e) => onContextChange({ schoolId: e.target.value })}
                className="bg-transparent font-medium text-gray-900 focus:outline-hidden text-xs cursor-pointer max-w-[200px] truncate"
              >
                <option value="sch-1">Դպրոց Ա (Երևան, հ. 120)</option>
                <option value="sch-2">Դպրոց Բ (Գյումրի, հ. 15)</option>
                <option value="sch-3">Դպրոց Գ (Վանաձոր, հ. 8)</option>
              </select>
            </div>

            {/* Term Selector */}
            <div className="flex items-center gap-1.5 bg-white px-2 py-0.5 rounded border border-indigo-200 shadow-2xs">
              <Calendar className="w-3 h-3 text-indigo-600" />
              <span className="text-gray-700 text-[11px]">{t.common.term}:</span>
              <select
                value={pinnedContext.term}
                onChange={(e) => onContextChange({ term: Number(e.target.value) as 1 | 2 })}
                className="bg-transparent font-medium text-gray-900 focus:outline-hidden text-xs cursor-pointer"
              >
                <option value={1}>1-ին կիսամյակ (16 շաբաթ)</option>
                <option value={2}>2-րդ կիսամյակ (18 շաբաթ)</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Navigation Sub-bar */}
      <div className="border-t border-gray-100 bg-gray-50/70">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <nav className="flex space-x-1 overflow-x-auto py-1.5 scrollbar-none">
            {visibleTabs.map((tab) => {
              const Icon = tab.icon;
              const isActive = currentTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => onTabChange(tab.id)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-xs font-semibold'
                      : 'text-gray-700 hover:text-gray-900 hover:bg-gray-200/80'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-white' : 'text-gray-700'}`} />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>
      </div>
    </header>
  );
};
