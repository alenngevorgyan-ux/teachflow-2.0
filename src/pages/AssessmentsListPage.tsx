import React, { useState, useEffect } from 'react';
import { CheckSquare, Trash2, Eye, Plus, Sparkles, RefreshCw } from 'lucide-react';
import { Assessment, Language } from '../../shared/types';
import { Badge } from '../components/Badge';
import { translations } from '../i18n/translations';

interface AssessmentsListPageProps {
  lang: Language;
  onSelectAssessment: (id: string) => void;
  onNavigateGenerate: () => void;
}

export const AssessmentsListPage: React.FC<AssessmentsListPageProps> = ({
  lang,
  onSelectAssessment,
  onNavigateGenerate,
}) => {
  const t = translations[lang];

  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchAssessments = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/assessments');
      const data = await res.json();
      setAssessments(data.assessments || []);
    } catch (err) {
      console.error('Failed to load assessments:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAssessments();
  }, []);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('Հեռացնե՞լ թեստը:')) return;
    try {
      await fetch(`/api/assessments/${id}`, { method: 'DELETE' });
      setAssessments((prev) => prev.filter((a) => a.id !== id));
    } catch (err) {
      console.error('Delete assessment failed:', err);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2.5">
            <CheckSquare className="w-6 h-6 text-indigo-600" />
            {t.nav.assessments}
          </h1>
          <p className="text-sm text-gray-700 mt-1">
            Գեներացված և վալիդացված թեստերի ցանկ, ուսուցչի վերանայում և արտահանում
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={fetchAssessments}
            className="p-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
            title={t.common.refresh}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onNavigateGenerate}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors shadow-xs"
          >
            <Plus className="w-4 h-4" />
            Գեներացնել նոր թեստ
          </button>
        </div>
      </div>

      {/* List */}
      {assessments.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center space-y-3">
          <Sparkles className="w-8 h-8 text-gray-400 mx-auto" />
          <h3 className="text-base font-semibold text-gray-900">
            Գեներացված թեստեր դեռևս չկան
          </h3>
          <p className="text-xs text-gray-700 max-w-sm mx-auto">
            Սեղմեք «Գեներացնել նոր թեստ»՝ ըստ պաշտոնական աղբյուրների ստուգված թեստ կազմելու համար:
          </p>
          <button
            onClick={onNavigateGenerate}
            className="mt-2 inline-flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-xs font-semibold hover:bg-indigo-700"
          >
            <Plus className="w-4 h-4" />
            Գեներացնել
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {assessments.map((a) => (
            <div
              key={a.id}
              onClick={() => onSelectAssessment(a.id)}
              className="bg-white rounded-xl border border-gray-200 p-5 shadow-xs hover:border-indigo-300 cursor-pointer transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4"
            >
              <div className="space-y-1.5 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-gray-700 bg-gray-100 px-2 py-0.5 rounded font-semibold">
                    {a.id}
                  </span>
                  <Badge
                    variant={
                      a.status === 'ready_for_classroom'
                        ? 'pass'
                        : a.status === 'validated'
                        ? 'info'
                        : a.status === 'refused'
                        ? 'fail'
                        : 'warn'
                    }
                  >
                    {a.status === 'ready_for_classroom'
                      ? t.common.readyForClassroom
                      : a.status === 'validated'
                      ? t.common.validated
                      : a.status === 'refused'
                      ? t.common.refused
                      : t.common.draft}
                  </Badge>
                  <span className="text-xs text-gray-700">
                    {a.subject}, {a.grade}-րդ դասարան
                  </span>
                </div>

                <h3 className="text-base font-semibold text-gray-900 leading-snug">
                  {a.topic}
                </h3>

                <div className="flex flex-wrap items-center gap-4 text-xs text-gray-700">
                  <span>
                    Հարցերի քանակ՝{' '}
                    <strong>{a.items.length}</strong> (A: {a.items.filter((i) => i.variant === 'A').length} / B: {a.items.filter((i) => i.variant === 'B').length})
                  </span>
                  <span>
                    Ամսաթիվ՝ {new Date(a.createdAt).toLocaleDateString()}
                  </span>
                  <span className="font-mono text-gray-700">
                    Policy: {a.policyVersion.substring(0, 8)}...
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0 pt-1">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectAssessment(a.id);
                  }}
                  className="px-3 py-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg text-xs font-semibold flex items-center gap-1.5"
                >
                  <Eye className="w-3.5 h-3.5" />
                  Դիտել
                </button>
                <button
                  onClick={(e) => handleDelete(a.id, e)}
                  className="p-1.5 text-gray-400 hover:text-rose-600 rounded-lg hover:bg-rose-50"
                  title={t.common.delete}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
