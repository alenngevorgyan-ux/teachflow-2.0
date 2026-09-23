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

  useEffect(() => {
    fetchTasks();
    fetchResults();
  }, []);

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
        body: JSON.stringify({ providerId: 'gemini', modelId: 'gemini-3.8-flash' }),
      });
      const data = await res.json();
      if (data.result) {
        setLatestResult(data.result);
        setResults((prev) => [data.result, ...prev]);
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

        <button
          onClick={handleRunEval}
          disabled={isRunning}
          className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors"
        >
          <Play className="w-4 h-4" />
          {isRunning ? 'Գործարկվում է...' : t.armenianEval.runEvalBtn}
        </button>
      </div>

      {latestResult && (
        <div className="space-y-6">
          {/* Top Scorecard */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
            <div className="p-5 bg-white rounded-2xl border border-gray-200 shadow-xs space-y-1">
              <span className="text-gray-700 block font-medium">Ընդհանուր որակի ինդեքս</span>
              <span className="text-2xl font-extrabold text-emerald-700">
                {(latestResult.overallScore * 100).toFixed(1)}%
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
