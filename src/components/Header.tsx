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
} from 'lucide-react';
import { Language, UserRole } from '../../shared/types';
import { translations } from '../i18n/translations';

interface HeaderProps {
  currentTab: string;
  onTabChange: (tab: string) => void;
  currentRole: UserRole;
  onRoleChange: (role: UserRole) => void;
  lang: Language;
  onLangChange: (lang: Language) => void;
  policyVersion?: string;
}

export const Header: React.FC<HeaderProps> = ({
  currentTab,
  onTabChange,
  currentRole,
  onRoleChange,
  lang,
  onLangChange,
  policyVersion,
}) => {
  const t = translations[lang];

  const allTabs = [
    { id: 'generate', label: t.nav.generate, icon: Sparkles, roles: ['teacher', 'methodologist', 'evaluator'] },
    { id: 'validateMaterial', label: t.nav.validateMaterial, icon: Search, roles: ['teacher', 'methodologist', 'evaluator'] },
    { id: 'assessments', label: t.nav.assessments, icon: CheckSquare, roles: ['teacher', 'methodologist', 'evaluator'] },
    { id: 'registry', label: t.nav.registry, icon: BookOpen, roles: ['methodologist', 'evaluator'] },
    { id: 'rules', label: t.nav.rules, icon: Sliders, roles: ['methodologist'] },
    { id: 'reviewQueue', label: t.nav.reviewQueue, icon: Inbox, roles: ['methodologist'] },
    { id: 'compare', label: t.nav.compare, icon: GitCompare, roles: ['evaluator', 'methodologist'] },
    { id: 'regression', label: t.nav.regression, icon: TrendingUp, roles: ['evaluator', 'methodologist'] },
    { id: 'aboutData', label: t.nav.aboutData, icon: Shield, roles: ['teacher', 'methodologist', 'evaluator'] },
  ];

  const visibleTabs = allTabs.filter((tab) => tab.roles.includes(currentRole));

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
      {/* Top Bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Product Name */}
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold text-lg shadow-xs">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-gray-900 text-lg tracking-tight">
                  TeachFlow
                </span>
                <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-700 font-medium border border-gray-200">
                  Curriculum Connector
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
              <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1 bg-gray-50 border border-gray-200 rounded text-xs text-gray-600">
                <span className="text-gray-700 font-mono">Policy:</span>
                <span className="font-mono font-medium text-gray-800">{policyVersion}</span>
              </div>
            )}

            {/* Role Switcher */}
            <div className="flex items-center bg-gray-100 p-0.5 rounded-lg border border-gray-200 text-xs">
              <UserCheck className="w-3.5 h-3.5 text-gray-700 ml-1.5 mr-0.5" />
              {(['teacher', 'methodologist', 'evaluator'] as UserRole[]).map((r) => (
                <button
                  key={r}
                  onClick={() => onRoleChange(r)}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    currentRole === r
                      ? 'bg-white text-gray-900 shadow-xs'
                      : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {t.roles[r]}
                </button>
              ))}
            </div>

            {/* Language Switcher */}
            <div className="flex items-center bg-gray-100 p-0.5 rounded-lg border border-gray-200 text-xs">
              <Globe className="w-3.5 h-3.5 text-gray-700 ml-1.5 mr-0.5" />
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
          </div>
        </div>
      </div>

      {/* Navigation Sub-bar */}
      <div className="border-t border-gray-100 bg-gray-50/50">
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
                      ? 'bg-indigo-50 text-indigo-700 border border-indigo-200 shadow-2xs font-semibold'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100/80'
                  }`}
                >
                  <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-indigo-600' : 'text-gray-700'}`} />
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
