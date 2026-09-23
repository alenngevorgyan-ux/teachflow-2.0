import React, { useState, useEffect } from 'react';
import {
  FileCheck2,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Sparkles,
  ShieldCheck,
  Send,
  MessageSquare,
  Building2,
  Calendar,
} from 'lucide-react';
import { Language, PinnedContext, Role, ReportInstance } from '../../shared/types';
import { translations } from '../i18n/translations';

interface AiReviewPageProps {
  lang: Language;
  role: Role;
  pinnedContext: PinnedContext;
}

export const AiReviewPage: React.FC<AiReviewPageProps> = ({
  lang,
  role,
  pinnedContext,
}) => {
  const t = translations[lang];

  const [reports, setReports] = useState<ReportInstance[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string>('');
  const [reviewResult, setReviewResult] = useState<any | null>(null);
  const [isRunningReview, setIsRunningReview] = useState(false);
  const [directorComment, setDirectorComment] = useState('');

  useEffect(() => {
    fetchReports();
  }, [pinnedContext.schoolId]);

  const fetchReports = async () => {
    try {
      const res = await fetch(`/api/reports?schoolId=${pinnedContext.schoolId}`);
      const data = await res.json();
      if (data.reports && data.reports.length > 0) {
        setReports(data.reports);
        setSelectedReportId(data.reports[0].id);
        runAiReview(data.reports[0].id);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const runAiReview = async (reportId: string) => {
    setIsRunningReview(true);
    try {
      const res = await fetch(`/api/reports/${reportId}/review`, { method: 'POST' });
      const data = await res.json();
      if (data.review) {
        setReviewResult(data.review);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsRunningReview(false);
    }
  };

  const handleUpdateStatus = async (status: ReportInstance['status']) => {
    if (!selectedReportId) return;
    try {
      await fetch(`/api/reports/${selectedReportId}/status`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, comment: directorComment }),
      });
      fetchReports();
      setDirectorComment('');
      alert(`Հաշվետվության կարգավիճակը թարմացվեց՝ «${status}»`);
    } catch (err) {
      console.error(err);
    }
  };

  const activeReport = reports.find((r) => r.id === selectedReportId);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-gray-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-purple-50 text-purple-700 rounded-xl">
              <FileCheck2 className="w-5 h-5" />
            </span>
            <h1 className="text-xl font-bold text-gray-900">{t.aiReview.title}</h1>
          </div>
          <p className="text-xs text-gray-700 mt-1">{t.aiReview.subtitle}</p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={selectedReportId}
            onChange={(e) => {
              setSelectedReportId(e.target.value);
              runAiReview(e.target.value);
            }}
            className="bg-gray-50 border border-gray-300 rounded-xl px-3 py-2 text-xs font-semibold text-gray-900 focus:outline-hidden"
          >
            {reports.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title} ({r.authorName})
              </option>
            ))}
          </select>

          <button
            onClick={() => selectedReportId && runAiReview(selectedReportId)}
            disabled={isRunningReview || !selectedReportId}
            className="flex items-center gap-1.5 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors"
          >
            <Sparkles className="w-4 h-4" />
            {isRunningReview ? 'Ստուգվում է...' : t.aiReview.runReviewBtn}
          </button>
        </div>
      </div>

      {reviewResult && activeReport && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left 2 Cols: Checks & Anomaly Analysis */}
          <div className="lg:col-span-2 space-y-6">
            {/* Overall Verdict Card */}
            <div
              className={`p-6 rounded-2xl border shadow-xs ${
                reviewResult.overallStatus === 'ready_for_approval'
                  ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                  : 'bg-amber-50/70 border-amber-200 text-amber-950'
              }`}
            >
              <div className="flex items-center justify-between border-b border-gray-200/40 pb-3">
                <div className="flex items-center gap-2">
                  {reviewResult.overallStatus === 'ready_for_approval' ? (
                    <CheckCircle className="w-6 h-6 text-emerald-600" />
                  ) : (
                    <AlertTriangle className="w-6 h-6 text-amber-600" />
                  )}
                  <div>
                    <h2 className="text-base font-bold">
                      {reviewResult.overallStatus === 'ready_for_approval'
                        ? 'Եզրակացություն. Հաշվետվությունը պատրաստ է հաստատման'
                        : 'Եզրակացություն. Առկա են ուշադրության արժանի շեղումներ'}
                    </h2>
                    <span className="text-xs text-gray-700 font-mono">
                      Ստուգման ամսաթիվ՝ {new Date(reviewResult.reviewedAt).toLocaleString('hy-AM')}
                    </span>
                  </div>
                </div>
                <span className="px-3 py-1 bg-white rounded-full font-bold text-xs shadow-2xs">
                  {reviewResult.overallStatus}
                </span>
              </div>

              <div className="mt-4 text-xs leading-relaxed space-y-2">
                <span className="font-bold text-gray-900 block">AI Փորձագիտական ամփոփագիր.</span>
                <p className="bg-white/80 p-3.5 rounded-xl border border-gray-200/80 text-gray-800">
                  {reviewResult.summaryArmenian}
                </p>
                <div className="font-semibold text-indigo-900">
                  Առաջարկվող գործողություն. {reviewResult.recommendation}
                </div>
              </div>
            </div>

            {/* Detailed 6-Layer Checks Table */}
            <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-xs space-y-4">
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider">
                {t.aiReview.checksList}
              </h3>
              <div className="space-y-3">
                {reviewResult.checks.map((c: any) => (
                  <div
                    key={c.id}
                    className="p-3.5 rounded-xl border border-gray-200 bg-gray-50/50 flex items-start justify-between gap-3 text-xs"
                  >
                    <div className="space-y-1">
                      <span className="font-bold text-gray-900">{c.name}</span>
                      <p className="text-gray-700">{c.details}</p>
                    </div>
                    <span
                      className={`px-2.5 py-0.5 rounded-full font-bold text-[10px] shrink-0 ${
                        c.status === 'pass'
                          ? 'bg-emerald-100 text-emerald-800'
                          : c.status === 'warn'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {c.status.toUpperCase()}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Identified Anomalies (Neutral phrasing) */}
            <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-xs space-y-4">
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider">
                {t.aiReview.anomalies} (Չեզոք ձևակերպումներ)
              </h3>
              <div className="space-y-2.5">
                {reviewResult.anomalies.map((anom: any, idx: number) => (
                  <div
                    key={idx}
                    className="p-3.5 rounded-xl bg-purple-50/50 border border-purple-200 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-purple-900">{anom.field}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded bg-purple-200/70 text-purple-800 font-mono">
                        {anom.severity}
                      </span>
                    </div>
                    <p className="text-gray-800">{anom.finding}</p>
                    <p className="text-indigo-700 italic">Առաջարկ՝ {anom.suggestedAction}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right Col: Decision & Commenting Action Panel */}
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-xs space-y-4 text-xs">
              <h3 className="text-sm font-bold text-gray-900">Որոշման կայացում</h3>
              <p className="text-gray-700">
                Մարդկային որոշման սկզբունք. AI-ն առաջարկում է, որոշումը կայացնում է տնօրենը կամ
                տեսուչը:
              </p>

              <div className="space-y-2">
                <span className="font-bold text-gray-800">Մեկնաբանություն հեղինակին.</span>
                <textarea
                  rows={4}
                  value={directorComment}
                  onChange={(e) => setDirectorComment(e.target.value)}
                  placeholder="Նշեք դիտարկումներ կամ առաջադրանք լրամշակման համար..."
                  className="w-full p-3 bg-gray-50 border border-gray-300 rounded-xl text-xs focus:outline-hidden focus:bg-white"
                />
              </div>

              <div className="space-y-2 pt-2">
                <button
                  onClick={() => handleUpdateStatus('accepted_by_director')}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold shadow-xs transition-colors flex items-center justify-center gap-2"
                >
                  <CheckCircle className="w-4 h-4" />
                  {t.aiReview.acceptReport}
                </button>
                <button
                  onClick={() => handleUpdateStatus('returned_for_correction')}
                  className="w-full py-2.5 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-bold shadow-xs transition-colors flex items-center justify-center gap-2"
                >
                  <AlertTriangle className="w-4 h-4" />
                  {t.aiReview.returnReport}
                </button>
              </div>
            </div>

            {/* Report Metadata */}
            <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-xs text-xs space-y-2">
              <span className="font-bold text-gray-900 block">Հաշվետվության տվյալներ</span>
              <div className="space-y-1 text-gray-700">
                <div>Վերնագիր՝ {activeReport.title}</div>
                <div>Դպրոց՝ {activeReport.schoolName}</div>
                <div>Հեղինակ՝ {activeReport.authorName}</div>
                <div>Ուսումնական տարի՝ {activeReport.academicYear}</div>
                <div>Ընթացիկ կարգավիճակ՝ {activeReport.status}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
