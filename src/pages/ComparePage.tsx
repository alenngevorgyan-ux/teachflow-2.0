import React, { useState } from 'react';
import {
  GitCompare,
  Download,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Clock,
  Cpu,
  Layers,
} from 'lucide-react';
import { Language, SideBySideReport } from '../../shared/types';
import { Badge } from '../components/Badge';
import { translations } from '../i18n/translations';

interface ComparePageProps {
  lang: Language;
}

export const ComparePage: React.FC<ComparePageProps> = ({ lang }) => {
  const t = translations[lang];

  const [subject, setSubject] = useState('Բնագիտություն');
  const [grade, setGrade] = useState(5);
  const [topic, setTopic] = useState('Լուսասինթեզի ընթացքը, քլորոպլաստները և թթվածնի անջատումը');
  const [isUncovered, setIsUncovered] = useState(false);
  const [numberOfRuns, setNumberOfRuns] = useState(2);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<SideBySideReport | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSetUncoveredPreset = () => {
    setIsUncovered(true);
    setSubject('Բնագիտություն');
    setGrade(5);
    setTopic('Քվանտային կրիպտոգրաֆիա և ֆոտոնային չիպեր');
  };

  const handleRunCompare = async () => {
    setLoading(true);
    setErrorMsg(null);
    setReport(null);

    try {
      const res = await fetch('/api/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject,
          grade: Number(grade),
          topic,
          isUncoveredTopicPreset: isUncovered,
          numberOfRuns: Number(numberOfRuns),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Համեմատության սխալ');
      setReport(data.report);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  const exportJson = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `side-by-side-${report.id}.json`;
    a.click();
  };

  const exportCsv = () => {
    if (!report) return;
    let csv = 'Run,Engine,UnsupportedClaims,CorrectRefusal,MethodAsFact,NoQuote,Equivalence,MachineTrace,LatencyMs\n';
    report.baselineRuns.forEach((r) => {
      csv += `${r.runIndex},Baseline,${r.unsupportedClaimsCount},${r.correctRefusal},${r.methodUsedAsFactCount},${r.itemsWithoutVerifiableQuote},${r.variantEquivalencePassed},${r.machineReadableTrace},${r.latencyMs}\n`;
    });
    report.teachflowRuns.forEach((r) => {
      csv += `${r.runIndex},TeachFlow,${r.unsupportedClaimsCount},${r.correctRefusal},${r.methodUsedAsFactCount},${r.itemsWithoutVerifiableQuote},${r.variantEquivalencePassed},${r.machineReadableTrace},${r.latencyMs}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `side-by-side-${report.id}.csv`;
    a.click();
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      {/* Header */}
      <div className="border-b border-gray-200 pb-5">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2.5">
          <GitCompare className="w-6 h-6 text-indigo-600" />
          {t.compare.title}
        </h1>
        <p className="text-sm text-gray-700 mt-1">{t.compare.subtitle}</p>
      </div>

      {/* Controls & Configuration */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-xs space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider">
            Համեմատության պարամետրեր
          </span>
          <button
            type="button"
            onClick={handleSetUncoveredPreset}
            className="text-xs px-3 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 font-medium hover:bg-amber-100 transition-colors"
          >
            ⚠️ {t.compare.uncoveredPresetBtn}
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 text-xs">
          <div>
            <label className="block font-medium text-gray-700 mb-1">
              {t.common.subject}
            </label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2.5 text-xs text-gray-900 outline-hidden focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block font-medium text-gray-700 mb-1">
              {t.common.grade}
            </label>
            <input
              type="number"
              min={1}
              max={12}
              value={grade}
              onChange={(e) => setGrade(Number(e.target.value))}
              className="w-full border border-gray-300 rounded-lg p-2.5 text-xs text-gray-900 outline-hidden focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="block font-medium text-gray-700 mb-1">
              {t.common.topic}
            </label>
            <input
              type="text"
              value={topic}
              onChange={(e) => {
                setTopic(e.target.value);
                setIsUncovered(false);
              }}
              className="w-full border border-gray-300 rounded-lg p-2.5 text-xs text-gray-900 outline-hidden focus:ring-1 focus:ring-indigo-500"
            />
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-2 border-t border-gray-100">
          <div className="flex items-center gap-3 text-xs">
            <label className="font-medium text-gray-700">
              {t.compare.runsCount}:
            </label>
            <select
              value={numberOfRuns}
              onChange={(e) => setNumberOfRuns(Number(e.target.value))}
              className="border border-gray-300 rounded-lg p-1.5 text-xs text-gray-900 bg-white"
            >
              <option value={1}>1 փորձարկում</option>
              <option value={2}>2 փորձարկում</option>
              <option value={3}>3 փորձարկում (ստանդարտ)</option>
            </select>
          </div>

          <button
            type="button"
            disabled={loading || !topic.trim()}
            onClick={handleRunCompare}
            className="px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 transition-colors shadow-xs flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Գործարկվում է {numberOfRuns} անգամյա զուգահեռ համեմատություն...</span>
              </>
            ) : (
              <>
                <GitCompare className="w-4 h-4" />
                <span>{t.compare.runCompareBtn}</span>
              </>
            )}
          </button>
        </div>

        {errorMsg && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800">
            {errorMsg}
          </div>
        )}
      </div>

      {/* Report Display */}
      {report && (
        <div className="space-y-6 animate-in fade-in">
          {/* Action Export Buttons */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs text-gray-700 font-mono">
              <Cpu className="w-4 h-4 text-indigo-600" />
              <span>Մոդել՝ {report.modelId}</span>
              <span>&bull;</span>
              <span>Ամսաթիվ՝ {new Date(report.executedAt).toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={exportCsv}
                className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                {t.common.exportCsv}
              </button>
              <button
                onClick={exportJson}
                className="px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                {t.common.exportJson}
              </button>
            </div>
          </div>

          {/* Aggregated Scorecard Table (Neutral Presentation) */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-xs">
            <div className="p-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
              <h3 className="text-sm font-bold text-gray-900">
                {t.compare.scorecard} (Միջինացված ցուցանիշներ)
              </h3>
              <span className="text-xs text-gray-700">
                Անկողմնակալ գնահատում անկախ վալիդատորի կողմից
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-gray-100/70 border-b border-gray-200 text-gray-700">
                  <tr>
                    <th className="p-3 font-semibold">Ցուցանիշ (Evaluation Metric)</th>
                    <th className="p-3 font-semibold text-gray-900">
                      Plain AI Baseline
                    </th>
                    <th className="p-3 font-semibold text-indigo-900">
                      TeachFlow Connector
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 text-gray-800">
                  <tr>
                    <td className="p-3 font-medium text-gray-900">
                      {t.compare.metricUnsupported}
                    </td>
                    <td className="p-3 font-mono">
                      {report.aggregated.baseline.avgUnsupportedClaims.toFixed(1)}
                    </td>
                    <td className="p-3 font-mono font-bold text-indigo-700">
                      {report.aggregated.teachflow.avgUnsupportedClaims.toFixed(1)}
                    </td>
                  </tr>
                  <tr>
                    <td className="p-3 font-medium text-gray-900">
                      {t.compare.metricRefusal}
                    </td>
                    <td className="p-3 font-mono">
                      {(report.aggregated.baseline.refusalCorrectnessRate * 100).toFixed(0)}%
                    </td>
                    <td className="p-3 font-mono font-bold text-indigo-700">
                      {(report.aggregated.teachflow.refusalCorrectnessRate * 100).toFixed(0)}%
                    </td>
                  </tr>
                  <tr>
                    <td className="p-3 font-medium text-gray-900">
                      {t.compare.metricMethodAsFact}
                    </td>
                    <td className="p-3 font-mono">
                      {report.aggregated.baseline.methodAsFactRate.toFixed(1)}
                    </td>
                    <td className="p-3 font-mono font-bold text-indigo-700">
                      {report.aggregated.teachflow.methodAsFactRate.toFixed(1)}
                    </td>
                  </tr>
                  <tr>
                    <td className="p-3 font-medium text-gray-900">
                      {t.compare.metricUnverifiableQuotes}
                    </td>
                    <td className="p-3 font-mono">
                      {report.aggregated.baseline.unverifiableQuoteRate.toFixed(1)}
                    </td>
                    <td className="p-3 font-mono font-bold text-indigo-700">
                      {report.aggregated.teachflow.unverifiableQuoteRate.toFixed(1)}
                    </td>
                  </tr>
                  <tr>
                    <td className="p-3 font-medium text-gray-900">
                      {t.compare.metricEquivalence}
                    </td>
                    <td className="p-3 font-mono">
                      {(report.aggregated.baseline.equivalencePassRate * 100).toFixed(0)}%
                    </td>
                    <td className="p-3 font-mono font-bold text-indigo-700">
                      {(report.aggregated.teachflow.equivalencePassRate * 100).toFixed(0)}%
                    </td>
                  </tr>
                  <tr>
                    <td className="p-3 font-medium text-gray-900">
                      {t.compare.metricStability}
                    </td>
                    <td className="p-3 font-mono">
                      {report.aggregated.baseline.stabilityAcrossRuns.toFixed(2)}
                    </td>
                    <td className="p-3 font-mono font-bold text-indigo-700">
                      {report.aggregated.teachflow.stabilityAcrossRuns.toFixed(2)}
                    </td>
                  </tr>
                  <tr>
                    <td className="p-3 font-medium text-gray-900">
                      {t.compare.metricTrace}
                    </td>
                    <td className="p-3">
                      <span className="text-rose-600 font-medium">Ոչ (Չկա մեքենայական հետագիծ)</span>
                    </td>
                    <td className="p-3">
                      <span className="text-emerald-700 font-bold">Այո (Per-item verifiable trace)</span>
                    </td>
                  </tr>
                  <tr>
                    <td className="p-3 font-medium text-gray-900">
                      Միջին տևողություն (Latency)
                    </td>
                    <td className="p-3 font-mono">
                      {(report.aggregated.baseline.avgLatencyMs / 1000).toFixed(1)} վրկ
                    </td>
                    <td className="p-3 font-mono">
                      {(report.aggregated.teachflow.avgLatencyMs / 1000).toFixed(1)} վրկ
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
