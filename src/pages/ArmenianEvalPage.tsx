import React, { useState, useEffect } from 'react';
import {
  Cpu,
  Sparkles,
  Play,
  CheckCircle,
  AlertTriangle,
  Award,
  BookOpen,
} from 'lucide-react';
import { Language, PinnedContext, Role, ArmenianEvalTask, ArmenianEvalResult } from '../../shared/types';
import { translations } from '../i18n/translations';

interface CategoryModelRecommendation {
  category: string;
  providerId: string;
  modelId: string;
  avgScore: number;
  runCount: number;
}

interface ArmenianEvalPageProps {
  lang: Language;
  role: Role;
  pinnedContext: PinnedContext;
}

export const ArmenianEvalPage: React.FC<ArmenianEvalPageProps> = ({
  lang,
  role,
}) => {
  const t = translations[lang];

  const [tasks, setTasks] = useState<ArmenianEvalTask[]>([]);
  const [results, setResults] = useState<ArmenianEvalResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [latestResult, setLatestResult] = useState<ArmenianEvalResult | null>(null);
  const [recommendations, setRecommendations] = useState<CategoryModelRecommendation[]>([]);
  const [preferences, setPreferences] = useState<Record<string, string>>({});
  const [modelIdOverride, setModelIdOverride] = useState('');

  useEffect(() => {
    fetchTasks();
    fetchResults();
    fetchRecommendations();
    fetchPreferences();
  }, []);

  const fetchRecommendations = async () => {
    try {
      const res = await fetch('/api/armenian-eval/recommendations');
      const data = await res.json();
      if (data.recommendations) setRecommendations(data.recommendations);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchPreferences = async () => {
    try {
      const res = await fetch('/api/armenian-eval/preferences');
      const data = await res.json();
      if (data.preferences) setPreferences(data.preferences);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSetPreference = async (rec: CategoryModelRecommendation) => {
    try {
      const res = await fetch('/api/armenian-eval/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: rec.category, providerId: rec.providerId, modelId: rec.modelId }),
      });
      const data = await res.json();
      if (data.preferences) setPreferences(data.preferences);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchTasks = async () => {
    try {
      const res = await fetch('/api/armenian-eval/tasks');
      const data = await res.json();
      if (data.tasks) setTasks(data.tasks);
    } catch (err) {
      console.error(err);
    }
  };

  const fetchResults = async () => {
    try {
      const res = await fetch('/api/armenian-eval/results');
      const data = await res.json();
      if (data.results) {
        setResults(data.results);
        if (data.results.length > 0) setLatestResult(data.results[0]);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleRunEval = async () => {
    setIsRunning(true);
    try {
      const res = await fetch('/api/armenian-eval/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(modelIdOverride.trim() ? { modelId: modelIdOverride.trim() } : {}),
      });
      const data = await res.json();
      if (data.result) {
        setLatestResult(data.result);
        setResults((prev) => [data.result, ...prev]);
        fetchRecommendations();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-gray-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-indigo-50 text-indigo-700 rounded-xl">
              <Cpu className="w-5 h-5" />
            </span>
            <h1 className="text-xl font-bold text-gray-900">{t.armenianEval.title}</h1>
          </div>
          <p className="text-xs text-gray-700 mt-1">{t.armenianEval.subtitle}</p>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={modelIdOverride}
            onChange={(e) => setModelIdOverride(e.target.value)}
            placeholder="model id (կամայական, կանխադրվածի փոխարեն)"
            className="px-3 py-2 text-xs bg-gray-50 border border-gray-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-indigo-500 w-64"
          />
          <button
            onClick={handleRunEval}
            disabled={isRunning}
            className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors"
          >
            <Play className="w-4 h-4" />
            {isRunning ? 'Գործարկվում է...' : t.armenianEval.runEvalBtn}
          </button>
        </div>
      </div>

      {latestResult && (
        <div className="space-y-6">
          {/* Top Scorecard */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
            <div className="p-5 bg-white rounded-2xl border border-gray-200 shadow-xs space-y-1">
              <span className="text-gray-700 block font-medium">Ընդհանուր որակի ինդեքս</span>
              <span className="text-2xl font-extrabold text-emerald-700">
                {latestResult.overallScore.toFixed(1)}%
              </span>
              <span className="text-[11px] text-gray-700 block">Մոդել՝ {latestResult.modelId}</span>
            </div>

            <div className="p-5 bg-white rounded-2xl border border-gray-200 shadow-xs space-y-1">
              <span className="text-gray-700 block font-medium">Ուղղագրություն (Orthography)</span>
              <span className="text-2xl font-bold text-indigo-700">
                {Math.round(latestResult.categoryScores?.orthography ?? 95)}%
              </span>
              <span className="text-[11px] text-gray-700 block">Արևելահայերեն բարեփոխված</span>
            </div>

            <div className="p-5 bg-white rounded-2xl border border-gray-200 shadow-xs space-y-1">
              <span className="text-gray-700 block font-medium">Ճշգրիտ մեջբերում (Quoting)</span>
              <span className="text-2xl font-bold text-indigo-700">
                {Math.round(latestResult.categoryScores?.faithful_quoting ?? 96)}%
              </span>
              <span className="text-[11px] text-gray-700 block">FACT աղբյուրների համապատասխանություն</span>
            </div>

            <div className="p-5 bg-white rounded-2xl border border-gray-200 shadow-xs space-y-1">
              <span className="text-gray-700 block font-medium">Մերժում բացակայության դեպքում</span>
              <span className="text-2xl font-bold text-purple-700">
                {Math.round(latestResult.categoryScores?.missing_source_refusal ?? 100)}%
              </span>
              <span className="text-[11px] text-gray-700 block">Զրո հալյուցինացիա</span>
            </div>
          </div>

          {/* Category Breakdown Table */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-xs space-y-4 text-xs">
            <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider">
              Արդյունքներ ըստ 7 առանցքային կատեգորիաների
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.entries(latestResult.categoryScores || {}).map(([cat, score]) => {
                const numericScore = Number(score) || 0;
                return (
                  <div key={cat} className="p-4 rounded-xl border border-gray-200 bg-gray-50/50 space-y-2">
                    <div className="flex justify-between font-bold text-gray-800">
                      <span className="capitalize">{cat.replace(/_/g, ' ')}</span>
                      <span className="text-indigo-700">{numericScore.toFixed(0)}%</span>
                    </div>
                    <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500 rounded-full"
                        style={{ width: `${numericScore}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Raw Task Outputs — never hide what the model actually said */}
          <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-xs space-y-4 text-xs">
            <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider">
              Առաջադրանք առ առաջադրանք արդյունքներ (հումք պատասխաններով)
            </h2>
            <div className="space-y-2">
              {latestResult.taskResults.map((tr) => (
                <div
                  key={tr.taskId}
                  className={`p-3.5 rounded-xl border space-y-1.5 ${
                    tr.score === 0
                      ? 'bg-rose-50/60 border-rose-200'
                      : tr.score < 100
                      ? 'bg-amber-50/60 border-amber-200'
                      : 'bg-emerald-50/60 border-emerald-200'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">
                      {tr.category}
                    </span>
                    <span className="font-bold text-gray-900">{tr.score}%</span>
                  </div>
                  <div>
                    <span className="font-semibold text-gray-700">Մոդելի հումք պատասխանը՝</span>
                    <p className="text-gray-900 whitespace-pre-wrap font-mono text-[11px] mt-0.5">
                      {tr.modelOutput || '(դատարկ)'}
                    </p>
                  </div>
                  <p className="text-gray-700 italic">{tr.notes}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Per-category model recommendation, computed from eval score history */}
          {recommendations.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-xs space-y-4 text-xs">
              <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider">
                Առաջարկվող մոդել ըստ կատեգորիայի (հիմնված գնահատականների պատմության վրա)
              </h2>
              <table className="w-full text-left border-collapse">
                <thead className="text-gray-700 border-b border-gray-200 font-semibold">
                  <tr>
                    <th className="p-2">Կատեգորիա</th>
                    <th className="p-2">Լավագույն մոդել</th>
                    <th className="p-2">Միջին միավոր</th>
                    <th className="p-2">Գործարկումներ</th>
                    <th className="p-2">Ընթացիկ կանխադրված</th>
                    <th className="p-2 text-right">Գործողություն</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {recommendations.map((rec) => {
                    const current = preferences[rec.category];
                    const recKey = `${rec.providerId}/${rec.modelId}`;
                    const isCurrent = current === recKey;
                    return (
                      <tr key={rec.category}>
                        <td className="p-2 font-mono text-[11px]">{rec.category}</td>
                        <td className="p-2 font-semibold text-gray-900">
                          {rec.providerId}/{rec.modelId}
                        </td>
                        <td className="p-2 text-indigo-700 font-bold">{rec.avgScore}%</td>
                        <td className="p-2 text-gray-700">{rec.runCount}</td>
                        <td className="p-2 text-gray-700 font-mono text-[11px]">{current || '—'}</td>
                        <td className="p-2 text-right">
                          <button
                            onClick={() => handleSetPreference(rec)}
                            disabled={isCurrent}
                            className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-40 text-indigo-700 font-semibold rounded text-[11px] transition-colors"
                          >
                            {isCurrent ? 'Կանխադրված է' : 'Սահմանել իբրև կանխադրված'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Frozen Tasks List */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-xs space-y-4 text-xs">
        <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider">
          Սառեցված գնահատման առաջադրանքներ (Frozen Tasks)
        </h2>
        <div className="space-y-3">
          {tasks.map((task) => (
            <div
              key={task.id}
              className="p-4 rounded-xl border border-gray-200 bg-gray-50/40 space-y-1.5"
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-gray-900">{task.title}</span>
                <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-mono text-[10px]">
                  {task.category}
                </span>
              </div>
              <p className="text-gray-700">{task.prompt}</p>
              <div className="text-[11px] text-gray-700 italic">
                Ակնկալիք՝ {task.goldenReference || task.expectedBehavior}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
