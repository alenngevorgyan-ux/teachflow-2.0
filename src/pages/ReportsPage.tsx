import React, { useState, useEffect } from 'react';
import {
  FileText,
  Plus,
  Download,
  AlertTriangle,
  CheckCircle,
  FileUp,
  Layers,
  Send,
  CornerDownLeft,
  Calendar,
  Building2,
  UserCheck,
} from 'lucide-react';
import { Language, PinnedContext, Role, ReportInstance, ReportTemplate } from '../../shared/types';
import { translations } from '../i18n/translations';

interface ReportsPageProps {
  lang: Language;
  role: Role;
  pinnedContext: PinnedContext;
}

export const ReportsPage: React.FC<ReportsPageProps> = ({
  lang,
  role,
  pinnedContext,
}) => {
  const t = translations[lang];

  const [reports, setReports] = useState<ReportInstance[]>([]);
  const [selectedReport, setSelectedReport] = useState<ReportInstance | null>(null);
  const [templates, setTemplates] = useState<ReportTemplate[]>([]);
  const [isConsolidating, setIsConsolidating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [legacyText, setLegacyText] = useState('');
  const [showLegacyModal, setShowLegacyModal] = useState(false);
  // No invented file name / author: both describe the imported document and
  // are typed by the teacher who imports it.
  const [legacyFileName, setLegacyFileName] = useState('');
  const [legacyAuthorName, setLegacyAuthorName] = useState('');
  const [legacyImportError, setLegacyImportError] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');

  useEffect(() => {
    fetchReports();
    fetchTemplates();
  }, [pinnedContext.schoolId]);

  const fetchReports = async () => {
    try {
      const res = await fetch(`/api/reports?schoolId=${pinnedContext.schoolId}`);
      const data = await res.json();
      if (data.reports) {
        setReports(data.reports);
        if (data.reports.length > 0 && !selectedReport) {
          setSelectedReport(data.reports[0]);
        }
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchTemplates = async () => {
    try {
      const res = await fetch('/api/report-templates');
      const data = await res.json();
      if (data.templates) {
        setTemplates(data.templates);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleStatusChange = async (newStatus: ReportInstance['status']) => {
    if (!selectedReport) return;
    try {
      const res = await fetch(`/api/reports/${selectedReport.id}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, comment: commentText }),
      });
      const data = await res.json();
      if (data.report) {
        setSelectedReport(data.report);
        setReports((prev) => prev.map((r) => (r.id === data.report.id ? data.report : r)));
        setCommentText('');
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Manual confirmation of the academic year (kept apart from report.data).
  const [yearDraft, setYearDraft] = useState('');
  const [yearName, setYearName] = useState('');
  const [yearSaving, setYearSaving] = useState(false);
  const [yearError, setYearError] = useState<string | null>(null);
  useEffect(() => {
    setYearDraft(selectedReport?.academicYear ?? '');
    setYearError(null);
  }, [selectedReport?.id]);

  const handleConfirmYear = async () => {
    if (!selectedReport) return;
    setYearSaving(true);
    setYearError(null);
    try {
      const res = await fetch(`/api/reports/${selectedReport.id}/metadata`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ academicYear: yearDraft.trim() === '' ? null : yearDraft.trim(), confirmedByName: yearName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      setReports((prev) => prev.map((r) => (r.id === data.report.id ? data.report : r)));
      setSelectedReport(data.report);
    } catch (err) {
      setYearError(err instanceof Error ? err.message : String(err));
    } finally {
      setYearSaving(false);
    }
  };

  // Consolidation inputs are chosen explicitly: nothing is preselected.
  const [showConsolidate, setShowConsolidate] = useState(false);
  const [consTemplate, setConsTemplate] = useState('');
  const [consPeriod, setConsPeriod] = useState('');
  const [consYear, setConsYear] = useState('');
  const [consError, setConsError] = useState<string | null>(null);
  const aggregateTemplates = templates.filter((tpl) => tpl.aggregatesFrom);
  const acceptedYears = [
    ...new Set(
      reports
        .filter((r) => r.schoolId === pinnedContext.schoolId && (r.status === 'accepted_by_director' || r.status === 'included_in_school_report'))
        .map((r) => r.academicYear)
        .filter((y): y is string => !!y)
    ),
  ];

  const handleConsolidateSchoolReport = async () => {
    if (!consTemplate || !consPeriod || !consYear.trim()) return;
    setIsConsolidating(true);
    setConsError(null);
    try {
      const res = await fetch('/api/reports/consolidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: consTemplate,
          schoolId: pinnedContext.schoolId,
          academicYear: consYear.trim(),
          period: consPeriod,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
      if (data.report) {
        setReports((prev) => [data.report, ...prev]);
        setSelectedReport(data.report);
        setShowConsolidate(false);
      }
    } catch (err) {
      setConsError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsConsolidating(false);
    }
  };

  const legacyImportReady =
    legacyText.trim() !== '' && legacyFileName.trim() !== '' && legacyAuthorName.trim() !== '';

  const handleLegacyImport = async () => {
    if (!legacyImportReady) return;
    setIsImporting(true);
    setLegacyImportError(null);
    try {
      const res = await fetch('/api/reports/legacy-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawText: legacyText,
          fileName: legacyFileName.trim(),
          templateId: 'tpl-program-progress',
          schoolId: pinnedContext.schoolId,
          authorName: legacyAuthorName.trim(),
        }),
      });
      const data = await res.json();
      if (res.ok && data.report) {
        setReports((prev) => [data.report, ...prev]);
        setSelectedReport(data.report);
        setShowLegacyModal(false);
        setLegacyText('');
        setLegacyFileName('');
        setLegacyAuthorName('');
      } else {
        setLegacyImportError(data.error || 'Ներմուծումը ձախողվեց: Անհայտ սխալ:');
      }
    } catch (err) {
      console.error(err);
      setLegacyImportError(err instanceof Error ? err.message : 'Ցանցային սխալ ներմուծման ժամանակ:');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-gray-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-indigo-50 text-indigo-700 rounded-xl">
              <FileText className="w-5 h-5" />
            </span>
            <h1 className="text-xl font-bold text-gray-900">{t.reports.title}</h1>
          </div>
          <p className="text-xs text-gray-700 mt-1">{t.reports.subtitle}</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setLegacyImportError(null);
              setShowLegacyModal(true);
            }}
            className="flex items-center gap-1.5 px-3.5 py-2 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 rounded-xl text-xs font-semibold shadow-2xs transition-colors"
          >
            <FileUp className="w-4 h-4 text-indigo-600" />
            {t.reports.legacyImport}
          </button>

          {(role === 'director' || role === 'methodologist' || role === 'admin') && (
            <button
              onClick={() => setShowConsolidate((v) => !v)}
              aria-expanded={showConsolidate}
              disabled={isConsolidating}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors"
            >
              <Layers className="w-4 h-4" />
              {t.reports.consolidateSchool}
            </button>
          )}
        </div>
      </div>

      {showConsolidate && (
        <section className="tf-section" aria-labelledby="consolidate-title">
          <h2 id="consolidate-title">{t.reports.consolidateSchool}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))', gap: 12 }}>
            <label className="tf-field">
              <span>{t.reports.consolidateTemplate}</span>
              <select className="tf-select" value={consTemplate} onChange={(e) => setConsTemplate(e.target.value)}>
                <option value="">{t.reports.consolidateChoose}</option>
                {aggregateTemplates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name.hy} ({tpl.version})
                  </option>
                ))}
              </select>
            </label>
            <label className="tf-field">
              <span>{t.reports.consolidatePeriod}</span>
              <select className="tf-select" value={consPeriod} onChange={(e) => setConsPeriod(e.target.value)}>
                <option value="">{t.reports.consolidateChoose}</option>
                <option value="term">{t.reports.periodTerm}</option>
                <option value="half_year">{t.reports.periodHalfYear}</option>
                <option value="year">{t.reports.periodYear}</option>
                <option value="on_demand">{t.reports.periodOnDemand}</option>
              </select>
            </label>
            <label className="tf-field">
              <span>{t.reports.consolidateYear}</span>
              <input className="tf-input" list="consolidate-years" value={consYear} onChange={(e) => setConsYear(e.target.value)} />
              <datalist id="consolidate-years">
                {acceptedYears.map((y) => (
                  <option key={y} value={y} />
                ))}
              </datalist>
              <span>
                {t.reports.consolidateYearHint}: {acceptedYears.join(', ') || '—'}
              </span>
            </label>
            <div className="tf-field">
              <span>{t.reports.consolidateSchoolLabel}</span>
              <span style={{ color: 'var(--tf-ink)' }}>{pinnedContext.schoolName ?? pinnedContext.schoolId}</span>
            </div>
          </div>
          {consError && (
            <div className="tf-notice" data-tone="error" role="alert">
              {t.reports.consolidateFailed}: {consError}
            </div>
          )}
          <div className="tf-actions">
            <button className="tf-btn tf-btn--primary" disabled={isConsolidating || !consTemplate || !consPeriod || !consYear.trim()} onClick={handleConsolidateSchoolReport}>
              {t.reports.consolidateSubmit}
            </button>
            <button className="tf-btn" onClick={() => setShowConsolidate(false)}>
              {t.reports.consolidateCancel}
            </button>
          </div>
        </section>
      )}

      {/* Unconfirmed Template Warning Banner */}
      <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-2xl text-xs text-amber-900 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
          <span>
            <strong>Չհաստատված աշխատանքային նախագծեր.</strong> Բոլոր 4 ձևանմուշները գտնվում են
            «draft_unconfirmed» կարգավիճակում՝ մինչև պետական լիազոր մարմնի պաշտոնական հաստատումը:
          </span>
        </div>
        <span className="text-[10px] font-mono px-2 py-0.5 bg-amber-200/80 rounded font-semibold text-amber-900">
          Template Status: draft_unconfirmed
        </span>
      </div>

      {/* Main Grid: Reports List & Active Report Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left: Reports List */}
        <div className="lg:col-span-1 bg-white p-4 rounded-2xl border border-gray-200 space-y-2">
          <span className="text-xs font-bold text-gray-700 uppercase tracking-wider block mb-2">
            Հաշվետվություններ ({reports.length})
          </span>
          <div className="space-y-2 overflow-y-auto max-h-[600px]">
            {reports.map((r) => (
              <button
                key={r.id}
                onClick={() => setSelectedReport(r)}
                className={`w-full text-left p-3 rounded-xl border transition-all text-xs space-y-1.5 ${
                  selectedReport?.id === r.id
                    ? 'bg-indigo-50/80 border-indigo-300 shadow-2xs font-semibold'
                    : 'bg-gray-50/50 border-gray-200 hover:bg-gray-100'
                }`}
              >
                <div className="text-gray-900 font-bold line-clamp-1">{r.title}</div>
                <div className="text-[11px] text-gray-700 flex items-center justify-between">
                  <span>{r.authorName}</span>
                  <span className="text-indigo-700 font-mono">{r.academicYear ?? 'n/a'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-200 text-gray-800 font-medium">
                    {r.status}
                  </span>
                  {r.importedFromLegacy && (
                    <span className="text-[10px] text-purple-700 font-semibold">Legacy Doc</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Right: Active Report Details & Lifecycle Workflow */}
        <div className="lg:col-span-3 space-y-6">
          {selectedReport ? (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-xs overflow-hidden">
              {/* Report Header */}
              <div className="p-6 border-b border-gray-100 bg-gray-50/60 flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold text-gray-900">{selectedReport.title}</h2>
                  <p className="text-xs text-gray-700 mt-0.5">
                    {selectedReport.schoolName} | Հեղինակ՝ {selectedReport.authorName} ({selectedReport.authorRole})
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <a
                    href={`/api/reports/${selectedReport.id}/export/csv`}
                    download
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-300 hover:bg-gray-50 rounded-lg text-xs font-medium text-gray-700 shadow-2xs transition-colors"
                  >
                    <Download className="w-3.5 h-3.5 text-gray-600" />
                    {t.common.exportCsv}
                  </a>
                </div>
              </div>

              {/* Status Pipeline Step Indicator */}
              <div className="p-4 bg-indigo-50/40 border-b border-gray-100 text-xs flex flex-wrap items-center gap-2">
                <span className="font-bold text-gray-700">Կարգավիճակ՝</span>
                <span className="px-2.5 py-1 rounded-full font-bold bg-indigo-100 text-indigo-800">
                  {selectedReport.status}
                </span>

                {/* Workflow Transitions depending on role */}
                <div className="ml-auto flex items-center gap-2">
                  {selectedReport.status === 'draft' && (
                    <button
                      onClick={() => handleStatusChange('submitted_to_director')}
                      className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold text-xs transition-colors"
                    >
                      Ուղարկել տնօրենին
                    </button>
                  )}

                  {(role === 'director' || role === 'admin') &&
                    selectedReport.status === 'submitted_to_director' && (
                      <>
                        <button
                          onClick={() => handleStatusChange('accepted_by_director')}
                          className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-xs transition-colors"
                        >
                          Ընդունել հաշվետվությունը
                        </button>
                        <button
                          onClick={() => handleStatusChange('returned_for_correction')}
                          className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg font-semibold text-xs transition-colors"
                        >
                          Վերադարձնել լրամշակման
                        </button>
                      </>
                    )}

                  {(role === 'reviewer' || role === 'admin') &&
                    selectedReport.status === 'submitted_to_reviewer' && (
                      <>
                        <button
                          onClick={() => handleStatusChange('accepted_by_reviewer')}
                          className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-xs transition-colors"
                        >
                          Հաստատել (Reviewer)
                        </button>
                        <button
                          onClick={() => handleStatusChange('reviewed_with_flags')}
                          className="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-semibold text-xs transition-colors"
                        >
                          Հաստատել դիտողություններով
                        </button>
                      </>
                    )}
                </div>
              </div>

              {/* Data Cards */}
              <div className="p-6 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs border-b border-gray-100">
                <div className="p-3 bg-gray-50 rounded-xl border border-gray-200">
                  <span className="text-gray-700 block">Պլանավորված ժամեր</span>
                  <span className="text-base font-bold text-gray-900">
                    {selectedReport.data.plannedHours != null ? `${selectedReport.data.plannedHours} ժամ` : 'n/a'}
                  </span>
                </div>
                <div className="p-3 bg-gray-50 rounded-xl border border-gray-200">
                  <span className="text-gray-700 block">Փաստացի անցած</span>
                  <span className="text-base font-bold text-gray-900">
                    {selectedReport.data.actualHours != null ? `${selectedReport.data.actualHours} ժամ` : 'n/a'}
                  </span>
                </div>
                <div className="p-3 bg-gray-50 rounded-xl border border-gray-200">
                  <span className="text-gray-700 block">Կատարողական (%)</span>
                  <span className="text-base font-bold text-emerald-700">
                    {selectedReport.data.completionPercentage != null ? `${selectedReport.data.completionPercentage}%` : 'n/a'}
                  </span>
                </div>
                <div className="p-3 bg-gray-50 rounded-xl border border-gray-200">
                  <span className="text-gray-700 block">Ծածկված չափորոշիչներ</span>
                  <span className="text-base font-bold text-indigo-700">
                    {Array.isArray(selectedReport.data.coveredOutcomes)
                      ? `${selectedReport.data.coveredOutcomes.length}`
                      : 'n/a'}
                  </span>
                </div>
              </div>

              {/* Academic year: extracted value, its provenance, and manual confirmation */}
              <section className="p-6 border-b border-gray-100 text-xs space-y-2" aria-labelledby="year-title">
                <h3 id="year-title" className="font-bold text-gray-900 text-sm">
                  {t.reports.yearTitle}: {selectedReport.academicYear ?? t.reports.yearMissing}
                </h3>
                <p className="text-gray-700">
                  {t.reports.yearProvenance}: {selectedReport.fieldProvenance?.academicYear ?? '—'}
                  {selectedReport.fieldConfidences?.academicYear !== undefined &&
                    ` · ${t.reports.yearConfidence}: ${Math.round(selectedReport.fieldConfidences.academicYear * 100)}%`}
                </p>
                {selectedReport.manualConfirmations?.academicYear && (
                  <p className="text-gray-700">
                    {t.reports.yearManual}: {selectedReport.manualConfirmations.academicYear.confirmedByName},{' '}
                    {selectedReport.manualConfirmations.academicYear.at.slice(0, 10)}
                  </p>
                )}
                <div className="flex flex-wrap items-end gap-2">
                  <label className="tf-field" style={{ flex: '1 1 12rem' }}>
                    <span>{t.reports.yearInput}</span>
                    <input className="tf-input" value={yearDraft} onChange={(e) => setYearDraft(e.target.value)} />
                  </label>
                  <label className="tf-field" style={{ flex: '1 1 16rem' }}>
                    <span>{t.reports.yearName}</span>
                    <input className="tf-input" value={yearName} onChange={(e) => setYearName(e.target.value)} />
                  </label>
                  <button className="tf-btn" disabled={!yearName.trim() || yearSaving} onClick={handleConfirmYear}>
                    {t.reports.yearConfirm}
                  </button>
                </div>
                {yearError && (
                  <div className="tf-notice" data-tone="error" role="alert">
                    {yearError}
                  </div>
                )}
              </section>

              {/* Field Provenance & Confidences Section */}
              {selectedReport.fieldConfidences && Object.keys(selectedReport.fieldConfidences).length > 0 && (
                <div className="p-6 border-b border-gray-100 space-y-3 bg-indigo-50/20 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-gray-900">Դաշտերի վստահություն և սկզբնաղբյուր (Provenance)</span>
                    <span className="text-[10px] text-gray-700 font-mono">Չճանաչված կամ 0% դաշտերը պահանջում են հաստատում</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {[
                      ...Object.entries(selectedReport.data),
                      // Report-level metadata extracted on legacy import
                      // (e.g. academicYear on a form without that field):
                      // its quote and confidence are shown like any field.
                      ...(['subject', 'grade', 'academicYear'] as const)
                        .filter((k) => !(k in selectedReport.data) && selectedReport.fieldConfidences?.[k] !== undefined)
                        .map((k) => [k, selectedReport[k]] as [string, unknown]),
                    ].map(([key, val]) => {
                      const conf = selectedReport.fieldConfidences?.[key];
                      const prov = selectedReport.fieldProvenance?.[key];
                      const isUnconfirmed = conf === 0 || conf === undefined || val === null;
                      return (
                        <div
                          key={key}
                          className={`p-2.5 rounded-lg border text-xs space-y-1 ${
                            isUnconfirmed ? 'bg-amber-50/80 border-amber-300' : 'bg-white border-gray-200'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-gray-800 font-semibold">{key}:</span>
                            <span
                              className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                                conf !== undefined && conf !== null
                                  ? conf > 0.8
                                    ? 'bg-emerald-100 text-emerald-800 font-bold'
                                    : conf === 0
                                    ? 'bg-rose-100 text-rose-800 font-bold'
                                    : 'bg-amber-100 text-amber-800 font-bold'
                                  : 'bg-gray-100 text-gray-500'
                              }`}
                            >
                              Conf: {conf !== undefined && conf !== null ? `${Math.round(conf * 100)}%` : 'n/a'}
                            </span>
                          </div>
                          <div className="text-gray-900 font-medium">
                            {val !== null && val !== undefined ? String(val) : <span className="text-rose-600 italic">լրացված չէ (null)</span>}
                          </div>
                          {prov && <div className="text-[11px] text-gray-700 italic truncate">{prov}</div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Report Body Content */}
              <div className="p-6 space-y-4 text-xs">
                <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 space-y-2">
                  <span className="font-bold text-gray-800">
                    Ուսուցչի մասնագիտական դիտարկումներ և վերլուծություն.
                  </span>
                  <p className="text-gray-700 leading-relaxed">
                    {selectedReport.data.teacherReflection || 'n/a'}
                  </p>
                </div>

                {/* Director / Reviewer Comments Thread */}
                <div className="space-y-2">
                  <span className="font-bold text-gray-800">Մեկնաբանություններ և դիտողություններ</span>
                  {selectedReport.comments && selectedReport.comments.length > 0 ? (
                    <div className="space-y-2">
                      {selectedReport.comments.map((c) => (
                        <div key={c.id} className="p-3 bg-amber-50/60 border border-amber-200 rounded-lg text-xs">
                          <div className="flex items-center justify-between text-[11px] text-amber-900 font-semibold mb-1">
                            <span>{c.authorName || c.author || 'Մեկնաբանող'}</span>
                            <span>{new Date(c.createdAt || c.date || Date.now()).toLocaleDateString('hy-AM')}</span>
                          </div>
                          <p className="text-gray-800">{c.text}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-700 italic">Դեռևս դիտողություններ չկան:</p>
                  )}

                  {/* Add comment box */}
                  <div className="flex gap-2 pt-2">
                    <input
                      type="text"
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      placeholder="Գրել դիտողություն կամ մեկնաբանություն..."
                      className="flex-1 px-3 py-1.5 bg-gray-50 border border-gray-300 rounded-lg text-xs focus:outline-hidden focus:bg-white"
                    />
                    <button
                      onClick={() => handleStatusChange(selectedReport.status)}
                      disabled={!commentText.trim()}
                      className="px-3 py-1.5 bg-gray-800 hover:bg-gray-900 disabled:opacity-50 text-white rounded-lg text-xs font-semibold"
                    >
                      Ավելացնել
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="p-12 text-center text-gray-700 bg-white rounded-2xl border border-gray-200 text-xs">
              Ընտրեք կամ ստեղծեք հաշվետվություն
            </div>
          )}
        </div>
      </div>

      {/* Modal: Legacy Report Importer */}
      {showLegacyModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 space-y-4 shadow-xl text-xs">
            <div className="flex items-center justify-between border-b border-gray-200 pb-3">
              <h3 className="text-base font-bold text-gray-900">
                Ներմուծել ոչ ստանդարտ հաշվետվություն (Legacy Import)
              </h3>
              <button
                onClick={() => setShowLegacyModal(false)}
                className="text-gray-700 hover:text-gray-700 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <p className="text-gray-700">
              Տեղադրեք հին Docx կամ PDF հաշվետվության տեքստը: TeachFlow-ը կկատարի կառուցվածքային
              քաղվածք, կվերագրի վստահության գործակիցներ (confidence) և ցույց կտա աղբյուրի տողերը (provenance):
            </p>

            {legacyImportError && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 font-medium">
                {legacyImportError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="font-semibold text-gray-900">Ֆայլի անունը *</span>
                <input
                  type="text"
                  value={legacyFileName}
                  onChange={(e) => setLegacyFileName(e.target.value)}
                  placeholder="hashvetvutyun_2025_1.docx"
                  className="w-full p-2 bg-gray-50 border border-gray-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                />
              </label>
              <label className="space-y-1">
                <span className="font-semibold text-gray-900">Հաշվետվության հեղինակը *</span>
                <input
                  type="text"
                  value={legacyAuthorName}
                  onChange={(e) => setLegacyAuthorName(e.target.value)}
                  placeholder="Ուսուցչի անուն ազգանուն"
                  className="w-full p-2 bg-gray-50 border border-gray-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
                />
              </label>
            </div>

            <textarea
              rows={8}
              value={legacyText}
              onChange={(e) => setLegacyText(e.target.value)}
              placeholder="Օրինակ՝ «Հաշվետվություն 2025 թ. 1-ին կիսամյակի: Դասավանդվել է Հայոց պատմություն 7-րդ դասարանում: Պլանավորված 32 ժամից անցել ենք 32-ը (100%): Ծրագիրը կատարված է...»"
              className="w-full p-3 bg-gray-50 border border-gray-300 rounded-xl font-mono text-xs focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
            />

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowLegacyModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-xl text-gray-700 hover:bg-gray-50 font-medium"
              >
                Չեղարկել
              </button>
              <button
                onClick={handleLegacyImport}
                disabled={isImporting || !legacyImportReady}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl font-semibold"
              >
                {isImporting ? 'Կատարվում է ներմուծում...' : 'Քաղել և ստեղծել'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
