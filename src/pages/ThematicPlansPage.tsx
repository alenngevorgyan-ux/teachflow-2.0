import React, { useState, useEffect } from 'react';
import {
  Calendar,
  CheckCircle,
  AlertTriangle,
  Download,
  Plus,
  Clock,
  Sparkles,
  BookOpen,
  ArrowRight,
  Filter,
} from 'lucide-react';
import { Language, PinnedContext, Role, ThematicPlan } from '../../shared/types';
import { translations } from '../i18n/translations';

interface ThematicPlansPageProps {
  lang: Language;
  role: Role;
  pinnedContext: PinnedContext;
  onSelectLessonPlan?: (planId: string) => void;
}

export const ThematicPlansPage: React.FC<ThematicPlansPageProps> = ({
  lang,
  role,
  pinnedContext,
}) => {
  const t = translations[lang];
  const [plans, setPlans] = useState<ThematicPlan[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<ThematicPlan | null>(null);
  const [validationResult, setValidationResult] = useState<{ valid: boolean; errors: string[] } | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    fetchPlans();
  }, [pinnedContext.subject, pinnedContext.grade]);

  const fetchPlans = async () => {
    try {
      const res = await fetch(`/api/thematic-plans?subject=${encodeURIComponent(pinnedContext.subject)}&grade=${pinnedContext.grade}`);
      const data = await res.json();
      if (data.plans) {
        setPlans(data.plans);
        if (data.plans.length > 0 && !selectedPlan) {
          setSelectedPlan(data.plans[0]);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleValidate = async () => {
    if (!selectedPlan) return;
    try {
      const res = await fetch(`/api/thematic-plans/${selectedPlan.id}/validate`);
      const data = await res.json();
      setValidationResult(data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleGenerateNew = async () => {
    setIsGenerating(true);
    try {
      const res = await fetch('/api/thematic-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: pinnedContext.subject,
          grade: pinnedContext.grade,
          programVersion: pinnedContext.programVersion,
          academicYear: pinnedContext.academicYear,
          schoolId: pinnedContext.schoolId,
          weeklyHours: 2,
          totalAnnualHours: 68,
        }),
      });
      const data = await res.json();
      if (data.plan) {
        setPlans((prev) => [data.plan, ...prev]);
        setSelectedPlan(data.plan);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleToggleTaught = async (rowId: string, currentTaught: boolean) => {
    if (!selectedPlan) return;
    try {
      const res = await fetch(`/api/thematic-plans/${selectedPlan.id}/rows/${rowId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taught: !currentTaught }),
      });
      const data = await res.json();
      if (data.plan) {
        setSelectedPlan(data.plan);
        setPlans((prev) => prev.map((p) => (p.id === data.plan.id ? data.plan : p)));
      }
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-gray-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-indigo-50 text-indigo-700 rounded-xl">
              <Calendar className="w-5 h-5" />
            </span>
            <h1 className="text-xl font-bold text-gray-900">{t.thematicPlan.title}</h1>
          </div>
          <p className="text-xs text-gray-700 mt-1">{t.thematicPlan.subtitle}</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleValidate}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-xl text-xs font-semibold shadow-2xs transition-colors"
          >
            <CheckCircle className="w-4 h-4 text-emerald-600" />
            {t.thematicPlan.validatePlan}
          </button>

          <button
            onClick={handleGenerateNew}
            disabled={isGenerating}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors"
          >
            <Plus className="w-4 h-4" />
            {t.thematicPlan.generatePlan}
          </button>
        </div>
      </div>

      {/* Validation Result Banner */}
      {validationResult && (
        <div
          className={`p-4 rounded-xl border text-xs flex items-start gap-3 ${
            validationResult.valid
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-amber-50 border-amber-200 text-amber-900'
          }`}
        >
          {validationResult.valid ? (
            <CheckCircle className="w-5 h-5 text-emerald-600 shrink-0" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
          )}
          <div className="space-y-1">
            <span className="font-bold">
              {validationResult.valid
                ? 'Պլանը լիովին համապատասխանում է ՀՀ ԿԳՄՍՆ պետական չափորոշիչներին:'
                : 'Հայտնաբերվել են չափորոշչային անհամապատասխանություններ:'}
            </span>
            {validationResult.errors.length > 0 && (
              <ul className="list-disc list-inside space-y-0.5 text-amber-800">
                {validationResult.errors.map((err, i) => (
                  <li key={i}>{err}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      {/* Main Grid: Plan Selector & Active Plan View */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left List of Plans */}
        <div className="lg:col-span-1 bg-white p-4 rounded-xl border border-gray-200 space-y-2">
          <span className="text-xs font-bold text-gray-700 uppercase tracking-wider block mb-2">
            Թեմատիկ պլաններ
          </span>
          {plans.map((p) => (
            <button
              key={p.id}
              onClick={() => {
                setSelectedPlan(p);
                setValidationResult(null);
              }}
              className={`w-full text-left p-3 rounded-lg border transition-all text-xs space-y-1 ${
                selectedPlan?.id === p.id
                  ? 'bg-indigo-50/80 border-indigo-300 shadow-2xs font-semibold'
                  : 'bg-gray-50/50 border-gray-200 hover:bg-gray-100'
              }`}
            >
              <div className="text-gray-900 line-clamp-1">{p.title}</div>
              <div className="text-[11px] text-gray-700">
                {p.academicYear} | {p.totalAnnualHours} ժամ
              </div>
            </button>
          ))}
        </div>

        {/* Right Active Plan Details */}
        <div className="lg:col-span-3 space-y-6">
          {selectedPlan ? (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
              {/* Header Info */}
              <div className="p-6 border-b border-gray-100 bg-gray-50/50 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">{selectedPlan.title}</h2>
                  <p className="text-xs text-gray-700 mt-1">
                    {selectedPlan.schoolName} | Ուսուցիչ՝ {selectedPlan.teacherName} | Կարգավիճակ՝ {selectedPlan.status}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={`/api/thematic-plans/${selectedPlan.id}/export/csv`}
                    download
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg text-xs font-medium text-gray-700 shadow-2xs transition-colors"
                  >
                    <Download className="w-3.5 h-3.5 text-gray-600" />
                    {t.common.exportCsv}
                  </a>
                </div>
              </div>

              {/* Progress Summary Cards */}
              <div className="p-6 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs border-b border-gray-100">
                <div className="p-3 bg-gray-50 rounded-xl border border-gray-200">
                  <span className="text-gray-700 block">Պլանավորված</span>
                  <span className="text-base font-bold text-gray-900">{selectedPlan.totalAnnualHours} ժամ</span>
                </div>
                <div className="p-3 bg-gray-50 rounded-xl border border-gray-200">
                  <span className="text-gray-700 block">Շաբաթական</span>
                  <span className="text-base font-bold text-indigo-700">{selectedPlan.weeklyHours} ժամ</span>
                </div>
                <div className="p-3 bg-gray-50 rounded-xl border border-gray-200">
                  <span className="text-gray-700 block">Փաստացի անցած</span>
                  <span className="text-base font-bold text-emerald-700">
                    {selectedPlan.rows.filter((r) => r.taught).reduce((s, r) => s + (r.actualHours ?? 0), 0)} ժամ
                  </span>
                </div>
                <div className="p-3 bg-gray-50 rounded-xl border border-gray-200">
                  <span className="text-gray-700 block">Առաջընթաց</span>
                  <span className="text-base font-bold text-purple-700">
                    {Math.round(
                      (selectedPlan.rows.filter((r) => r.taught).length / (selectedPlan.rows.length || 1)) * 100
                    )}%
                  </span>
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-gray-50 text-gray-700 font-semibold border-b border-gray-200">
                    <tr>
                      <th className="p-3.5">{t.thematicPlan.tableHeaders.week}</th>
                      <th className="p-3.5">{t.thematicPlan.tableHeaders.topic}</th>
                      <th className="p-3.5">{t.thematicPlan.tableHeaders.outcomes}</th>
                      <th className="p-3.5 text-center">{t.thematicPlan.tableHeaders.plannedHours}</th>
                      <th className="p-3.5">{t.thematicPlan.tableHeaders.assessment}</th>
                      <th className="p-3.5 text-center">{t.thematicPlan.tableHeaders.status}</th>
                      <th className="p-3.5 text-right">{t.thematicPlan.tableHeaders.action}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {selectedPlan.rows.map((row) => (
                      <tr key={row.id} className="hover:bg-gray-50/80 transition-colors">
                        <td className="p-3.5 font-bold text-gray-600">#{row.weekNumber}</td>
                        <td className="p-3.5 font-medium text-gray-900 max-w-xs">{row.topic}</td>
                        <td className="p-3.5">
                          <div className="flex flex-wrap gap-1">
                            {row.outcomeCodes.map((c) => (
                              <span
                                key={c}
                                className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-mono text-[10px]"
                              >
                                {c}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="p-3.5 text-center font-bold text-gray-800">{row.plannedHours} ժ</td>
                        <td className="p-3.5">
                          {row.hasAssessment ? (
                            <span className="px-2 py-0.5 bg-amber-50 text-amber-800 border border-amber-200 rounded font-semibold text-[10px]">
                              {row.assessmentType === 'summative' ? 'Ամփոփիչ' : 'Ձևավորող'}
                            </span>
                          ) : (
                            <span className="text-gray-600">—</span>
                          )}
                        </td>
                        <td className="p-3.5 text-center">
                          <button
                            onClick={() => handleToggleTaught(row.id, Boolean(row.taught))}
                            className={`px-2.5 py-1 rounded-full text-[10px] font-semibold transition-colors ${
                              row.taught
                                ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                          >
                            {row.taught ? '✓ Անցած' : 'Չանցած'}
                          </button>
                        </td>
                        <td className="p-3.5 text-right">
                          <button
                            onClick={async () => {
                              const res = await fetch('/api/lesson-plans/generate', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  thematicPlanId: selectedPlan.id,
                                  rowId: row.id,
                                }),
                              });
                              const data = await res.json();
                              if (res.ok && data.lessonPlan) {
                                alert(
                                  `Դասի պլանը ստեղծված է «${row.topic}» թեմայով (ստուգման կարգավիճակ՝ ${data.lessonPlan.trace.status}):`
                                );
                              } else {
                                alert(`Ձախողվեց. ${data.error || 'անհայտ սխալ'}`);
                              }
                            }}
                            className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-semibold rounded text-[11px] transition-colors"
                          >
                            {t.thematicPlan.createLessonPlanBtn}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="p-12 text-center text-gray-700 bg-white rounded-2xl border border-gray-200 text-xs">
              Ընտրեք կամ ստեղծեք նոր թեմատիկ պլան
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
