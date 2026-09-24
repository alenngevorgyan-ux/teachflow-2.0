import React, { useState, useEffect } from 'react';
import { Language, Role, PinnedContext } from '../shared/types';
import { AppShell } from './components/shell/AppShell';
import { HomePage } from './pages/HomePage';
import { translations } from './i18n/translations';
import { Footer } from './components/Footer';

// TeachFlow 3.0 Pages
import { WorkspacePage } from './pages/WorkspacePage';
import { ThematicPlansPage } from './pages/ThematicPlansPage';
import { AutoGradingPage } from './pages/AutoGradingPage';
import { ReportsPage } from './pages/ReportsPage';
import { AiReviewPage } from './pages/AiReviewPage';
import { DashboardsPage } from './pages/DashboardsPage';
import { GlossaryPage } from './pages/GlossaryPage';
import { ArmenianEvalPage } from './pages/ArmenianEvalPage';

// TeachFlow 2.0 Core Pages (Preserved)
import { RegistryPage } from './pages/RegistryPage';
import { RulesPage } from './pages/RulesPage';
import { GeneratePage } from './pages/GeneratePage';
import { ValidateMaterialPage } from './pages/ValidateMaterialPage';
import { MaterialReviewPage } from './pages/MaterialReviewPage';
import { AssessmentsListPage } from './pages/AssessmentsListPage';
import { AssessmentViewPage } from './pages/AssessmentViewPage';
import { ComparePage } from './pages/ComparePage';
import { RegressionPage } from './pages/RegressionPage';
import { ReviewQueuePage } from './pages/ReviewQueuePage';
import { AboutDataPage } from './pages/AboutDataPage';

export function App() {
  const [lang, setLang] = useState<Language>('hy');
  const [role, setRole] = useState<Role>('teacher');
  // The tab (and an open material) live in the URL hash so a reload returns
  // to the same place: #/<tab> or #/materials/<id>.
  const initial = parseHash(window.location.hash);
  const [currentTab, setCurrentTabState] = useState<string>(initial.tab);
  const [materialId, setMaterialId] = useState<string | null>(initial.materialId);
  const [navOpen, setNavOpen] = useState(false);
  const [fixtureMode, setFixtureMode] = useState(false);
  const setCurrentTab = (tab: string) => {
    setCurrentTabState(tab);
    if (tab !== 'materialReview') setMaterialId(null);
  };
  const [selectedAssessmentId, setSelectedAssessmentId] = useState<string | null>(null);
  const [policyVersion, setPolicyVersion] = useState<string>('');

  // Top-level Pinned Context State
  const [pinnedContext, setPinnedContext] = useState<PinnedContext>({
    subject: 'Հայոց պատմություն',
    grade: 7,
    programVersion: 'demo-v1',
    academicYear: '2026-2027',
    schoolId: 'sch-1',
    term: 1,
  });

  useEffect(() => {
    const hash = currentTab === 'materialReview' && materialId ? `#/materials/${materialId}` : `#/${currentTab}`;
    if (window.location.hash !== hash) window.history.pushState(null, '', hash);
  }, [currentTab, materialId]);

  useEffect(() => {
    const onPop = () => {
      const h = parseHash(window.location.hash);
      setCurrentTabState(h.tab);
      setMaterialId(h.materialId);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = 'ltr';
  }, [lang]);

  useEffect(() => {
    fetch('/api/runtime')
      .then((r) => r.json())
      .then((d) => setFixtureMode(d.fixtureMode === true))
      .catch(() => setFixtureMode(false));
  }, []);

  useEffect(() => {
    fetch('/api/system/policy-version')
      .then((r) => r.json())
      .then((data) => {
        if (data.policyVersion) {
          setPolicyVersion(data.policyVersion);
        }
      })
      .catch(console.error);
  }, [currentTab]);

  const handleRoleChange = (newRole: Role) => {
    setRole(newRole);
    if (newRole === 'methodologist') {
      setCurrentTab('thematicPlans');
    } else if (newRole === 'director') {
      setCurrentTab('reports');
    } else if (newRole === 'reviewer') {
      setCurrentTab('aiReview');
    } else if (newRole === 'admin') {
      setCurrentTab('dashboards');
    } else {
      setCurrentTab('home');
    }
  };

  const handleContextChange = (updates: Partial<PinnedContext>) => {
    setPinnedContext((prev) => ({ ...prev, ...updates }));
  };

  const handleNavigateToAssessment = (id: string) => {
    setSelectedAssessmentId(id);
    setCurrentTab('assessmentView');
  };

  const handleResetDemoData = async () => {
    if (window.confirm(translations[lang].shell.resetConfirm)) {
      try {
        await fetch('/api/system/reset-demo', { method: 'POST' });
        window.location.reload();
      } catch (err) {
        console.error('Failed to reset demo data:', err);
      }
    }
  };

  return (
    <AppShell
      lang={lang}
      onLangChange={setLang}
      role={role}
      onRoleChange={handleRoleChange}
      currentTab={currentTab}
      onTabChange={(tab) => {
        setSelectedAssessmentId(null);
        setCurrentTab(tab);
      }}
      pinnedContext={pinnedContext}
      onContextChange={handleContextChange}
      policyVersion={policyVersion}
      onResetDemo={handleResetDemoData}
      fixtureMode={fixtureMode}
      navOpen={navOpen}
      onNavOpenChange={setNavOpen}
    >
        {currentTab === 'home' && (
          <HomePage
            lang={lang}
            role={role}
            onNavigate={(tab) => setCurrentTab(tab)}
            onOpenMaterial={(id) => {
              setCurrentTabState('materialReview');
              setMaterialId(id);
            }}
          />
        )}
        {/* TeachFlow 3.0 Modules */}
        {currentTab === 'workspace' && (
          <WorkspacePage
            lang={lang}
            role={role}
            pinnedContext={pinnedContext}
            onNavigateTab={(tab) => setCurrentTab(tab)}
          />
        )}
        {currentTab === 'thematicPlans' && (
          <ThematicPlansPage
            lang={lang}
            role={role}
            pinnedContext={pinnedContext}
          />
        )}
        {currentTab === 'autoGrading' && (
          <AutoGradingPage
            lang={lang}
            role={role}
            pinnedContext={pinnedContext}
          />
        )}
        {currentTab === 'reports' && (
          <ReportsPage
            lang={lang}
            role={role}
            pinnedContext={pinnedContext}
          />
        )}
        {currentTab === 'aiReview' && (
          <AiReviewPage
            lang={lang}
            role={role}
            pinnedContext={pinnedContext}
          />
        )}
        {currentTab === 'dashboards' && (
          <DashboardsPage
            lang={lang}
            role={role}
            pinnedContext={pinnedContext}
          />
        )}
        {currentTab === 'glossary' && (
          <GlossaryPage
            lang={lang}
            role={role}
            pinnedContext={pinnedContext}
          />
        )}
        {currentTab === 'armenianEval' && (
          <ArmenianEvalPage
            lang={lang}
            role={role}
            pinnedContext={pinnedContext}
          />
        )}

        {/* TeachFlow 2.0 Modules (Preserved & Integrated) */}
        {currentTab === 'registry' && <RegistryPage lang={lang} />}
        {currentTab === 'rules' && <RulesPage lang={lang} />}
        {currentTab === 'generate' && (
          <GeneratePage
            lang={lang}
            onViewAssessment={(id) => handleNavigateToAssessment(id)}
          />
        )}
        {currentTab === 'validateMaterial' && <ValidateMaterialPage lang={lang} />}
        {currentTab === 'materialReview' && (
          <MaterialReviewPage lang={lang} pinnedContext={pinnedContext} materialId={materialId} onOpenMaterial={setMaterialId} />
        )}
        {currentTab === 'assessments' && (
          <AssessmentsListPage
            lang={lang}
            onSelectAssessment={(id) => handleNavigateToAssessment(id)}
            onNavigateGenerate={() => setCurrentTab('generate')}
          />
        )}
        {currentTab === 'assessmentView' && (
          <AssessmentViewPage
            assessmentId={selectedAssessmentId || undefined}
            lang={lang}
            onBackToList={() => {
              setSelectedAssessmentId(null);
              setCurrentTab('assessments');
            }}
          />
        )}
        {currentTab === 'compare' && <ComparePage lang={lang} />}
        {currentTab === 'regression' && <RegressionPage lang={lang} />}
        {currentTab === 'reviewQueue' && (
          <ReviewQueuePage
            lang={lang}
            onNavigateToAssessment={(id) => handleNavigateToAssessment(id)}
          />
        )}
        {currentTab === 'aboutData' && <AboutDataPage lang={lang} />}
        <Footer lang={lang} />
    </AppShell>
  );
}

const KNOWN_TABS = new Set([
  'home', 'workspace', 'thematicPlans', 'autoGrading', 'reports', 'aiReview', 'dashboards', 'glossary', 'armenianEval',
  'registry', 'rules', 'generate', 'validateMaterial', 'materialReview', 'assessments', 'compare', 'regression', 'reviewQueue', 'aboutData',
]);

function parseHash(hash: string): { tab: string; materialId: string | null } {
  const m = /^#\/materials\/([\w-]+)$/.exec(hash);
  if (m) return { tab: 'materialReview', materialId: m[1] };
  const tab = hash.replace(/^#\//, '');
  return { tab: KNOWN_TABS.has(tab) ? tab : 'home', materialId: null };
}

export default App;
