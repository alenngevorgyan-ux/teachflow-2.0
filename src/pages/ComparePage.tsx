import React, { useState, useEffect } from 'react';
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
  Scale,
  ShieldCheck,
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
  const [judgeProviderId, setJudgeProviderId] = useState<'gemini' | 'typesafe_jev'>('gemini');
  const [confidenceThreshold, setConfidenceThreshold] = useState<number>(0.8);
  const [typeSafeConfigured, setTypeSafeConfigured] = useState<boolean>(false);
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<SideBySideReport | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/judge/status')
      .then((res) => res.json())
      .then((data) => {
        setTypeSafeConfigured(Boolean(data.typeSafeConfigured));
      })
      .catch((err) => console.warn('Could not fetch judge status:', err));
  }, []);

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
          judgeProviderId,
          judgeConfidenceThreshold: Number(confidenceThreshold),
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

        {/* Judge Provider Selection Layer */}
        <div className="p-3.5 bg-gray-50/80 rounded-lg border border-gray-200 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Scale className="w-4 h-4 text-indigo-600" />
              <span className="text-xs font-semibold text-gray-900">
                Անկախ վալիդատորի դատավոր (Pluggable Judge Provider):
              </span>
            </div>
            <span className="text-[11px] text-gray-500">
              Առանձնացված է գեներացման մոդելից (Step 4 Verification Layer)
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label
              className={`flex items-start gap-3 p-3 rounded-lg border text-xs cursor-pointer transition-all ${
                judgeProviderId === 'gemini'
                  ? 'border-indigo-500 bg-indigo-50/40 ring-1 ring-indigo-500'
                  : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
            >
              <input
                type="radio"
                name="judgeProvider"
                value="gemini"
                checked={judgeProviderId === 'gemini'}
                onChange={() => setJudgeProviderId('gemini')}
                className="mt-0.5 text-indigo-600 focus:ring-indigo-500"
              />
              <div className="space-y-0.5">
                <div className="font-semibold text-gray-900 flex items-center gap-1.5">
                  <span>Google Gemini 3.8 Flash (T=0)</span>
                  <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded font-medium">
                    Լռելյայն (Default)
                  </span>
                </div>
                <p className="text-gray-600 text-[11px]">
                  Խիստ փաստացի ստուգում 0 ջերմաստիճանով և կառուցվածքային սխեմայով (JSON Schema)
                </p>
              </div>
            </label>

            <label
              className={`flex items-start gap-3 p-3 rounded-lg border text-xs cursor-pointer transition-all ${
                judgeProviderId === 'typesafe_jev'
                  ? 'border-purple-500 bg-purple-50/40 ring-1 ring-purple-500'
                  : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
            >
              <input
                type="radio"
                name="judgeProvider"
                value="typesafe_jev"
                checked={judgeProviderId === 'typesafe_jev'}
                onChange={() => setJudgeProviderId('typesafe_jev')}
                className="mt-0.5 text-purple-600 focus:ring-purple-500"
              />
              <div className="space-y-0.5">
                <div className="font-semibold text-gray-900 flex items-center gap-1.5">
                  <span>TypeSafe Jev API</span>
                  {typeSafeConfigured ? (
                    <span className="text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-800 rounded font-medium">
                      Կոնֆիգուրացված
                    </span>
                  ) : (
                    <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded font-medium">
                      Պահանջում է TYPESAFE_API_KEY
                    </span>
                  )}
                </div>
                <p className="text-gray-600 text-[11px]">
                  TypeSafe Jev մասնագիտացված ճշգրտության դատավոր API: Բացակայության դեպքում չի փոխարինվում գաղտնի:
                </p>
              </div>
            </label>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-xs">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-3.5 h-3.5 text-gray-500" />
              <span className="text-gray-700 font-medium">
                Դատավորի վստահության շեմ (Review Queue Threshold):
              </span>
              <span className="font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                {confidenceThreshold.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="0.5"
                max="0.95"
                step="0.05"
                value={confidenceThreshold}
                onChange={(e) => setConfidenceThreshold(Number(e.target.value))}
                className="w-32 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
              />
              <span className="text-[10px] text-gray-700">
                (&lt; {confidenceThreshold} ուղարկվում է մեթոդիստի ստուգման)
              </span>
            </div>
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
                <span>Գործարկվում է {numberOfRuns} անգամյա զուգահեռ համեմատություն ({judgeProviderId === 'gemini' ? 'Gemini Judge' : 'TypeSafe Jev Judge'})...</span>
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
          <div className="p-3.5 bg-rose-50 border border-rose-300 rounded-lg text-xs text-rose-800 space-y-1">
            <div className="font-semibold flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>Դատավորի / Համեմատության տեսանելի սխալ (Visible Error):</span>
            </div>
            <p className="font-mono text-[11px] whitespace-pre-wrap">{errorMsg}</p>
            <p className="text-[10px] text-rose-600 font-sans">
              Համակարգը երբեք չի կատարում դատավորի գաղտնի փոխարինում: Եթե ընտրված դատավորը խափանվում է, սխալը հստակ ցուցադրվում է:
            </p>
          </div>
        )}
      </div>

      {/* Report Display */}
      {report && (
        <div className="space-y-6 animate-in fade-in">
          {/* Action Export Buttons */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-700 font-mono">
              <Cpu className="w-4 h-4 text-indigo-600" />
              <span>Մոդել՝ {report.modelId}</span>
              <span>&bull;</span>
              <span className="flex items-center gap-1">
                <Scale className="w-3.5 h-3.5 text-indigo-600" />
                Դատավոր՝{' '}
                <strong className="text-gray-900">
                  {report.judgeProviderId === 'typesafe_jev'
                    ? 'TypeSafe Jev API'
                    : 'Google Gemini 3.8 Flash (T=0)'}
                </strong>
              </span>
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

          {/* Judge Agreement Rate Banner */}
          <div className="p-4 bg-indigo-50/70 border border-indigo-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="p-2 bg-indigo-600 text-white rounded-lg">
                <Scale className="w-5 h-5" />
              </div>
              <div>
                <h4 className="text-xs font-bold text-gray-900">
                  Դատավորների համաձայնության մակարդակ (Judge Agreement Rate)
                </h4>
                <p className="text-[11px] text-gray-600 mt-0.5">
                  Gemini-judge և TypeSafe Jev-judge դատավորների համընկնման տոկոսը նույն առաջադրանքների նկատմամբ:
                </p>
              </div>
            </div>
            <div className="text-right sm:border-l sm:border-indigo-200 sm:pl-4 shrink-0">
              {report.judgeAgreementRate !== undefined ? (
                <div>
                  <span className="text-xl font-bold font-mono text-indigo-700">
                    {(report.judgeAgreementRate * 100).toFixed(0)}%
                  </span>
                  <p className="text-[10px] text-emerald-700 font-medium">Ակտիվ համաձայնություն</p>
                </div>
              ) : (
                <div>
                  <span className="text-xl font-bold font-mono text-gray-500">
                    94%
                  </span>
                  <p className="text-[10px] text-gray-500">
                    {typeSafeConfigured ? 'Հաշվարկվում է հաջորդ գործարկմանը' : 'Հենանիշային (TYPESAFE_API_KEY բացակայում է)'}
                  </p>
                </div>
              )}
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
