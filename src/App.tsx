import React, { useState, useEffect } from 'react';
import { Language, UserRole } from '../shared/types';
import { Header } from './components/Header';
import { Footer } from './components/Footer';
import { RegistryPage } from './pages/RegistryPage';
import { RulesPage } from './pages/RulesPage';
import { GeneratePage } from './pages/GeneratePage';
import { ValidateMaterialPage } from './pages/ValidateMaterialPage';
import { AssessmentsListPage } from './pages/AssessmentsListPage';
import { AssessmentViewPage } from './pages/AssessmentViewPage';
import { ComparePage } from './pages/ComparePage';
import { RegressionPage } from './pages/RegressionPage';
import { ReviewQueuePage } from './pages/ReviewQueuePage';
import { AboutDataPage } from './pages/AboutDataPage';

export function App() {
  const [lang, setLang] = useState<Language>('hy');
  const [role, setRole] = useState<UserRole>('teacher');
  const [currentTab, setCurrentTab] = useState<string>('generate');
  const [selectedAssessmentId, setSelectedAssessmentId] = useState<string | null>(null);
  const [policyVersion, setPolicyVersion] = useState<string>('');

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

  const handleRoleChange = (newRole: UserRole) => {
    setRole(newRole);
    if (newRole === 'methodologist') {
      setCurrentTab('registry');
    } else if (newRole === 'evaluator') {
      setCurrentTab('compare');
    } else {
      setCurrentTab('generate');
    }
  };

  const handleNavigateToAssessment = (id: string) => {
    setSelectedAssessmentId(id);
    setCurrentTab('assessmentView');
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 text-gray-900 selection:bg-indigo-100 font-sans">
      <Header
        currentTab={currentTab}
        onTabChange={(tab) => {
          setSelectedAssessmentId(null);
          setCurrentTab(tab);
        }}
        currentRole={role}
        onRoleChange={handleRoleChange}
        lang={lang}
        onLangChange={setLang}
        policyVersion={policyVersion}
      />

      <main className="flex-1">
        {currentTab === 'registry' && <RegistryPage lang={lang} />}
        {currentTab === 'rules' && <RulesPage lang={lang} />}
        {currentTab === 'generate' && (
          <GeneratePage
            lang={lang}
            onViewAssessment={(id) => handleNavigateToAssessment(id)}
          />
        )}
        {currentTab === 'validateMaterial' && <ValidateMaterialPage lang={lang} />}
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
      </main>

      <Footer lang={lang} />
    </div>
  );
}

export default App;
