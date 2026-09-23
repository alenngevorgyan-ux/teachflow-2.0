import React, { useState, useEffect } from 'react';
import {
  FileText,
  Printer,
  Download,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Eye,
  Edit2,
  Save,
  CheckSquare,
  ShieldCheck,
  Sparkles,
  Layers,
  ArrowLeft,
} from 'lucide-react';
import { Assessment, AssessmentItem, ItemTrace, Language } from '../../shared/types';
import { Badge } from '../components/Badge';
import { ItemTraceModal } from '../components/ItemTraceModal';
import { translations } from '../i18n/translations';

interface AssessmentViewPageProps {
  assessmentId?: string;
  lang: Language;
  onBackToList: () => void;
}

export const AssessmentViewPage: React.FC<AssessmentViewPageProps> = ({
  assessmentId,
  lang,
  onBackToList,
}) => {
  const t = translations[lang];

  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'variants' | 'keys' | 'equivalence'>('variants');
  const [selectedTraceItem, setSelectedTraceItem] = useState<{
    item: AssessmentItem;
    trace?: ItemTrace;
  } | null>(null);

  // Edit item state
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editedStem, setEditedStem] = useState('');
  const [editedAnswerKey, setEditedAnswerKey] = useState('');
  const [savingItem, setSavingItem] = useState(false);

  const fetchAssessment = async (id: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/assessments/${id}`);
      const data = await res.json();
      setAssessment(data.assessment || null);
    } catch (err) {
      console.error('Failed to load assessment:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (assessmentId) {
      fetchAssessment(assessmentId);
    }
  }, [assessmentId]);

  if (!assessment) {
    return (
      <div className="max-w-4xl mx-auto p-8 text-center text-gray-500">
        <p>{loading ? t.common.loading : 'Առաջադրանքը չի գտնվել'}</p>
        <button
          onClick={onBackToList}
          className="mt-4 px-4 py-2 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
        >
          &larr; Վերադառնալ ցուցակին
        </button>
      </div>
    );
  }

  const itemsA = assessment.items.filter((i) => i.variant === 'A');
  const itemsB = assessment.items.filter((i) => i.variant === 'B');

  const handleStartEdit = (item: AssessmentItem) => {
    setEditingItemId(item.id);
    setEditedStem(item.stem);
    setEditedAnswerKey(String(item.answerKey));
  };

  const handleSaveEdit = async (itemId: string) => {
    setSavingItem(true);
    try {
      const res = await fetch(`/api/assessments/${assessment.id}/items/${itemId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item: {
            stem: editedStem,
            answerKey: editedAnswerKey,
          },
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setAssessment(data.assessment);
        setEditingItemId(null);
      }
    } catch (err) {
      console.error('Failed to save edited item:', err);
    } finally {
      setSavingItem(false);
    }
  };

  const failingItemIds = assessment.traces.filter((tr) => tr.status === 'FAIL').map((tr) => tr.itemId);
  const warningItemIds = assessment.traces.filter((tr) => tr.status === 'WARN').map((tr) => tr.itemId);

  const handleMarkReady = async () => {
    if (failingItemIds.length > 0) {
      alert(t.common.readyBlockedByFail.replace('{{count}}', String(failingItemIds.length)));
      return;
    }

    if (warningItemIds.length > 0) {
      const confirmed = window.confirm(
        t.common.readyConfirmWarnings.replace('{{count}}', String(warningItemIds.length))
      );
      if (!confirmed) return;
    }

    try {
      const res = await fetch(`/api/assessments/${assessment.id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'ready_for_classroom',
          acceptedWarnings: warningItemIds,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setAssessment({ ...assessment, status: 'ready_for_classroom', acceptedWarnings: warningItemIds });
      } else {
        alert(data.error || 'Failed to mark ready for classroom.');
      }
    } catch (err) {
      console.error('Failed to mark ready:', err);
    }
  };

  const handleExportJsonTrace = () => {
    const blob = new Blob([JSON.stringify(assessment, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `assessment-trace-${assessment.id}.json`;
    a.click();
  };

  const handlePrint = () => {
    window.print();
  };

  const handleExportDocx = () => {
    // Generate clean text/html content formatted for Word document
    const content = `
      <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head><meta charset='utf-8'><title>${assessment.topic}</title></head>
      <body>
        <h2>${assessment.subject} — ${assessment.grade}-րդ դասարան</h2>
        <h3>Թեմա՝ ${assessment.topic}</h3>
        <hr/>
        <h4>ՏԱՐԲԵՐԱԿ Ա</h4>
        ${itemsA
          .map(
            (it, idx) => `
          <p><strong>${idx + 1}. ${it.stem}</strong></p>
          ${it.options ? it.options.map((o, i) => `<p style='margin-left: 20px;'>${String.fromCharCode(65 + i)}) ${o}</p>`).join('') : ''}
        `
          )
          .join('')}
        <br/><hr/>
        <h4>ՏԱՐԲԵՐԱԿ Բ</h4>
        ${itemsB
          .map(
            (it, idx) => `
          <p><strong>${idx + 1}. ${it.stem}</strong></p>
          ${it.options ? it.options.map((o, i) => `<p style='margin-left: 20px;'>${String.fromCharCode(65 + i)}) ${o}</p>`).join('') : ''}
        `
          )
          .join('')}
        <br/><hr/>
        <h4>ՊԱՏԱՍԽԱՆՆԵՐԻ ՍՏՈՒԳԱԹԵՐԹԻԿ (ԱՌԱՆՁԻՆ)</h4>
        <p><strong>Տարբերակ Ա:</strong> ${itemsA.map((it, idx) => `${idx + 1}: ${it.answerKey}`).join(', ')}</p>
        <p><strong>Տարբերակ Բ:</strong> ${itemsB.map((it, idx) => `${idx + 1}: ${it.answerKey}`).join(', ')}</p>
      </body>
      </html>
    `;
    const blob = new Blob([content], { type: 'application/msword' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `test-${assessment.subject}-${assessment.grade}gr.doc`;
    a.click();
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-6 print:p-0">
      {/* Navigation & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-200 pb-4 print:hidden">
        <button
          onClick={onBackToList}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900"
        >
          <ArrowLeft className="w-4 h-4" />
          Բոլոր թեստերը
        </button>

        <div className="flex flex-wrap items-center gap-2">
          {assessment.status !== 'ready_for_classroom' && (
            <button
              onClick={handleMarkReady}
              disabled={failingItemIds.length > 0}
              title={
                failingItemIds.length > 0
                  ? t.common.readyBlockedByFail.replace('{{count}}', String(failingItemIds.length))
                  : undefined
              }
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold shadow-xs flex items-center gap-1.5 ${
                failingItemIds.length > 0
                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  : 'bg-emerald-600 text-white hover:bg-emerald-700'
              }`}
            >
              <CheckSquare className="w-3.5 h-3.5" />
              {t.common.readyForClassroom}
            </button>
          )}

          <button
            onClick={handleExportDocx}
            className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-1.5"
          >
            <Download className="w-3.5 h-3.5 text-gray-500" />
            {t.common.exportDocx}
          </button>

          <button
            onClick={handlePrint}
            className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-1.5"
          >
            <Printer className="w-3.5 h-3.5 text-gray-500" />
            {t.common.print}
          </button>

          <button
            onClick={handleExportJsonTrace}
            className="px-3 py-1.5 bg-indigo-50 border border-indigo-200 rounded-lg text-xs font-medium text-indigo-700 hover:bg-indigo-100 flex items-center gap-1.5"
          >
            <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
            {t.common.exportJson}
          </button>
        </div>
      </div>

      {/* Assessment Header Card */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-xs space-y-4 print:border-none print:shadow-none print:p-0">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-gray-700 bg-gray-100 px-2 py-0.5 rounded font-semibold">
                {assessment.id}
              </span>
              <Badge
                variant={
                  assessment.status === 'ready_for_classroom'
                    ? 'pass'
                    : assessment.status === 'validated'
                    ? 'info'
                    : assessment.status === 'refused'
                    ? 'fail'
                    : 'warn'
                }
              >
                {assessment.status === 'ready_for_classroom'
                  ? t.common.readyForClassroom
                  : assessment.status === 'validated'
                  ? t.common.validated
                  : assessment.status === 'refused'
                  ? t.common.refused
                  : t.common.draft}
              </Badge>
              <span className="text-xs text-gray-700 font-mono">
                Policy: {assessment.policyVersion.substring(0, 8)}...
              </span>
            </div>

            <h1 className="text-xl font-bold text-gray-900 leading-snug">
              {assessment.subject} — {assessment.grade}-րդ դասարան
            </h1>
            <p className="text-sm font-medium text-gray-700">
              Թեմա՝ «{assessment.topic}»
            </p>
          </div>

          <div className="text-xs text-gray-700 sm:text-right font-mono print:hidden">
            <span>Գեներացված՝ {new Date(assessment.createdAt).toLocaleDateString()}</span>
          </div>
        </div>

        {/* Coverage summary */}
        {assessment.coverage && (
          <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs space-y-1 print:hidden">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-900">Ծածկույթի ստուգում՝</span>
              <Badge variant={assessment.coverage.topicCovered ? 'pass' : 'fail'} size="sm">
                {assessment.coverage.topicCovered ? 'Ծածկված է' : 'Մերժված'}
              </Badge>
              <span className="text-gray-700">
                Վերջնարդյունքներ՝ {assessment.coverage.coveredOutcomeCodes.join(', ') || 'N/A'}
              </span>
            </div>
          </div>
        )}

        {/* View Switcher: Variants A & B vs Keys vs Equivalence */}
        <div className="border-b border-gray-200 flex space-x-4 text-xs font-semibold print:hidden">
          <button
            onClick={() => setActiveTab('variants')}
            className={`pb-2 transition-colors border-b-2 ${
              activeTab === 'variants'
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Առաջադրանքներ (Տարբերակ Ա և Բ)
          </button>
          <button
            onClick={() => setActiveTab('keys')}
            className={`pb-2 transition-colors border-b-2 ${
              activeTab === 'keys'
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Պատասխանների ստուգաթերթիկ (Առանձին)
          </button>
          <button
            onClick={() => setActiveTab('equivalence')}
            className={`pb-2 transition-colors border-b-2 ${
              activeTab === 'equivalence'
                ? 'border-indigo-600 text-indigo-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Տարբերակների համարժեքություն (Equivalence Check)
          </button>
        </div>
      </div>

      {/* Render Variants A & B Side by Side or Stacked */}
      {activeTab === 'variants' && (
        <div className="space-y-8">
          {/* Variant A */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-xs space-y-4 print:p-0 print:border-none">
            <div className="flex items-center justify-between border-b border-gray-100 pb-2">
              <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-800 flex items-center justify-center text-xs font-bold">
                  Ա
                </span>
                Տարբերակ Ա ({itemsA.length} առաջադրանք)
              </h2>
            </div>

            <div className="space-y-4">
              {itemsA.map((item, idx) => {
                const trace = assessment.traces.find((t) => t.itemId === item.id);
                const isEditing = editingItemId === item.id;

                return (
                  <div
                    key={item.id}
                    className="p-4 rounded-lg border border-gray-200 bg-white space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-gray-900 text-sm">
                            {idx + 1}.
                          </span>
                          <span className="text-xs font-medium text-gray-700 font-mono">
                            [{item.type} &bull; {item.difficulty}]
                          </span>
                          {trace && (
                            <Badge
                              size="sm"
                              variant={
                                trace.status === 'PASS'
                                  ? 'pass'
                                  : trace.status === 'WARN'
                                  ? 'warn'
                                  : 'fail'
                              }
                            >
                              {trace.status}
                            </Badge>
                          )}
                        </div>

                        {isEditing ? (
                          <div className="space-y-2 pt-1 text-xs">
                            <textarea
                              rows={2}
                              value={editedStem}
                              onChange={(e) => setEditedStem(e.target.value)}
                              className="w-full border border-gray-300 rounded p-2 text-xs font-medium"
                            />
                            <div className="flex items-center gap-2">
                              <label className="text-gray-700">Ճիշտ պատասխան՝</label>
                              <input
                                type="text"
                                value={editedAnswerKey}
                                onChange={(e) => setEditedAnswerKey(e.target.value)}
                                className="border border-gray-300 rounded p-1 text-xs font-medium"
                              />
                            </div>
                            <div className="flex items-center gap-2 pt-1">
                              <button
                                disabled={savingItem}
                                onClick={() => handleSaveEdit(item.id)}
                                className="px-3 py-1 bg-indigo-600 text-white rounded text-xs font-semibold hover:bg-indigo-700 flex items-center gap-1"
                              >
                                <Save className="w-3.5 h-3.5" />
                                Պահպանել և վերաստուգել (Re-validate)
                              </button>
                              <button
                                onClick={() => setEditingItemId(null)}
                                className="px-3 py-1 border border-gray-300 rounded text-xs text-gray-700"
                              >
                                Չեղարկել
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm font-medium text-gray-900 pt-1">
                            {item.stem}
                          </p>
                        )}

                        {item.options && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-2">
                            {item.options.map((opt, i) => (
                              <div
                                key={i}
                                className="text-xs p-2 rounded bg-gray-50 border border-gray-200 text-gray-800"
                              >
                                <span className="font-semibold mr-1.5">
                                  {String.fromCharCode(65 + i)})
                                </span>
                                {opt}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0 print:hidden">
                        {!isEditing && (
                          <button
                            onClick={() => handleStartEdit(item)}
                            className="p-1.5 border border-gray-200 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-50"
                            title="Խմբագրել առաջադրանքը"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        )}

                        <button
                          onClick={() => setSelectedTraceItem({ item, trace })}
                          className="px-2.5 py-1.5 border border-indigo-200 bg-indigo-50/50 rounded-lg text-xs font-medium text-indigo-700 hover:bg-indigo-100 flex items-center gap-1"
                        >
                          <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
                          Trace
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Variant B */}
          <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-xs space-y-4 print:p-0 print:border-none print:break-before-page">
            <div className="flex items-center justify-between border-b border-gray-100 pb-2">
              <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center text-xs font-bold">
                  Բ
                </span>
                Տարբերակ Բ ({itemsB.length} առաջադրանք)
              </h2>
            </div>

            <div className="space-y-4">
              {itemsB.map((item, idx) => {
                const trace = assessment.traces.find((t) => t.itemId === item.id);
                const isEditing = editingItemId === item.id;

                return (
                  <div
                    key={item.id}
                    className="p-4 rounded-lg border border-gray-200 bg-white space-y-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-gray-900 text-sm">
                            {idx + 1}.
                          </span>
                          <span className="text-xs font-medium text-gray-700 font-mono">
                            [{item.type} &bull; {item.difficulty}]
                          </span>
                          {trace && (
                            <Badge
                              size="sm"
                              variant={
                                trace.status === 'PASS'
                                  ? 'pass'
                                  : trace.status === 'WARN'
                                  ? 'warn'
                                  : 'fail'
                              }
                            >
                              {trace.status}
                            </Badge>
                          )}
                        </div>

                        {isEditing ? (
                          <div className="space-y-2 pt-1 text-xs">
                            <textarea
                              rows={2}
                              value={editedStem}
                              onChange={(e) => setEditedStem(e.target.value)}
                              className="w-full border border-gray-300 rounded p-2 text-xs font-medium"
                            />
                            <div className="flex items-center gap-2">
                              <label className="text-gray-700">Ճիշտ պատասխան՝</label>
                              <input
                                type="text"
                                value={editedAnswerKey}
                                onChange={(e) => setEditedAnswerKey(e.target.value)}
                                className="border border-gray-300 rounded p-1 text-xs font-medium"
                              />
                            </div>
                            <div className="flex items-center gap-2 pt-1">
                              <button
                                disabled={savingItem}
                                onClick={() => handleSaveEdit(item.id)}
                                className="px-3 py-1 bg-indigo-600 text-white rounded text-xs font-semibold hover:bg-indigo-700 flex items-center gap-1"
                              >
                                <Save className="w-3.5 h-3.5" />
                                Պահպանել և վերաստուգել
                              </button>
                              <button
                                onClick={() => setEditingItemId(null)}
                                className="px-3 py-1 border border-gray-300 rounded text-xs text-gray-700"
                              >
                                Չեղարկել
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm font-medium text-gray-900 pt-1">
                            {item.stem}
                          </p>
                        )}

                        {item.options && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 pt-2">
                            {item.options.map((opt, i) => (
                              <div
                                key={i}
                                className="text-xs p-2 rounded bg-gray-50 border border-gray-200 text-gray-800"
                              >
                                <span className="font-semibold mr-1.5">
                                  {String.fromCharCode(65 + i)})
                                </span>
                                {opt}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2 shrink-0 print:hidden">
                        {!isEditing && (
                          <button
                            onClick={() => handleStartEdit(item)}
                            className="p-1.5 border border-gray-200 rounded-lg text-gray-500 hover:text-gray-800 hover:bg-gray-50"
                            title="Խմբագրել առաջադրանքը"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        )}

                        <button
                          onClick={() => setSelectedTraceItem({ item, trace })}
                          className="px-2.5 py-1.5 border border-indigo-200 bg-indigo-50/50 rounded-lg text-xs font-medium text-indigo-700 hover:bg-indigo-100 flex items-center gap-1"
                        >
                          <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
                          Trace
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Answer Keys Tab (Separated layout for classroom use) */}
      {activeTab === 'keys' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-xs space-y-6">
          <div className="border-b border-gray-100 pb-3">
            <h2 className="text-base font-bold text-gray-900">
              Ճիշտ պատասխանների ստուգաթերթիկ (Ուսուցչի համար)
            </h2>
            <p className="text-xs text-gray-700">
              Տպելու դեպքում կարող է տպվել թեստից առանձին էջի վրա:
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Keys A */}
            <div className="p-4 rounded-lg border border-indigo-100 bg-indigo-50/30 space-y-3">
              <h3 className="text-sm font-bold text-indigo-950">ՏԱՐԲԵՐԱԿ Ա</h3>
              <div className="divide-y divide-gray-100 text-xs">
                {itemsA.map((item, idx) => (
                  <div key={item.id} className="py-2 flex items-center justify-between">
                    <span className="font-semibold text-gray-700">Հարց #{idx + 1}</span>
                    <span className="font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      {String(item.answerKey)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Keys B */}
            <div className="p-4 rounded-lg border border-emerald-100 bg-emerald-50/30 space-y-3">
              <h3 className="text-sm font-bold text-emerald-950">ՏԱՐԲԵՐԱԿ Բ</h3>
              <div className="divide-y divide-gray-100 text-xs">
                {itemsB.map((item, idx) => (
                  <div key={item.id} className="py-2 flex items-center justify-between">
                    <span className="font-semibold text-gray-700">Հարց #{idx + 1}</span>
                    <span className="font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      {String(item.answerKey)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Variant Equivalence Tab */}
      {activeTab === 'equivalence' && (
        <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-xs space-y-4">
          <div className="border-b border-gray-100 pb-3">
            <h2 className="text-base font-bold text-gray-900">
              Տարբերակ Ա և Բ համարժեքության ստուգում (Variant Equivalence)
            </h2>
            <p className="text-xs text-gray-700">
              Ստուգում է հարցերի քանակը, տեսակների և բարդության հավասարաչափ բաշխումը, ինչպես նաև ճանաչողական համարժեքությունը:
            </p>
          </div>

          <div className="space-y-3">
            {assessment.variantEquivalence.map((chk, i) => (
              <div
                key={i}
                className="p-4 rounded-lg border border-gray-200 bg-white flex items-start gap-3 text-xs"
              >
                <div className="mt-0.5 shrink-0">
                  {chk.result === 'pass' && (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  )}
                  {chk.result === 'warn' && (
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                  )}
                  {chk.result === 'fail' && (
                    <XCircle className="w-4 h-4 text-rose-600" />
                  )}
                </div>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-gray-900">{chk.label}</span>
                    <Badge
                      size="sm"
                      variant={
                        chk.result === 'pass'
                          ? 'pass'
                          : chk.result === 'warn'
                          ? 'warn'
                          : 'fail'
                      }
                    >
                      {chk.result.toUpperCase()}
                    </Badge>
                  </div>
                  <p className="text-gray-600 leading-relaxed">{chk.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trace Drawer Modal */}
      {selectedTraceItem && (
        <ItemTraceModal
          item={selectedTraceItem.item}
          trace={selectedTraceItem.trace}
          onClose={() => setSelectedTraceItem(null)}
        />
      )}
    </div>
  );
};
