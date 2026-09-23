import React, { useState, useEffect } from 'react';
import {
  TrendingUp,
  Play,
  ArrowRightLeft,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Plus,
  RefreshCw,
  Clock,
  Cpu,
} from 'lucide-react';
import { FrozenTask, Language, RegressionRun } from '../../shared/types';
import { Badge } from '../components/Badge';
import { translations } from '../i18n/translations';

interface RegressionPageProps {
  lang: Language;
}

interface RegressionDiffResponse {
  summaryText: string;
  accuracyChange: number;
  latencyChange: number;
  failRateChange: number;
  tasksWithChanges: {
    taskId: string;
    topic: string;
    statusChange: 'improved' | 'degraded' | 'unchanged';
    detail: string;
  }[];
}

export const RegressionPage: React.FC<RegressionPageProps> = ({ lang }) => {
  const t = translations[lang];

  const [tasks, setTasks] = useState<FrozenTask[]>([]);
  const [runs, setRuns] = useState<RegressionRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [runningSuite, setRunningSuite] = useState(false);
  const [diff, setDiff] = useState<RegressionDiffResponse | null>(null);

  // Diff select
  const [olderRunId, setOlderRunId] = useState('');
  const [newerRunId, setNewerRunId] = useState('');

  // Add task modal
  const [showAddTask, setShowAddTask] = useState(false);
  const [newTaskTopic, setNewTaskTopic] = useState('');
  const [newTaskSubject, setNewTaskSubject] = useState('Բնագիտություն');
  const [newTaskGrade, setNewTaskGrade] = useState(5);
  const [newTaskExpected, setNewTaskExpected] = useState<'generate' | 'refuse'>('generate');

  const fetchData = async () => {
    setLoading(true);
    try {
      const [tRes, rRes] = await Promise.all([
        fetch('/api/regression/tasks').then((r) => r.json()),
        fetch('/api/regression/runs').then((r) => r.json()),
      ]);
      setTasks(tRes.tasks || []);
      const rList: RegressionRun[] = rRes.runs || [];
      setRuns(rList);
      if (rList.length >= 2) {
        setOlderRunId(rList[rList.length - 2].id);
        setNewerRunId(rList[rList.length - 1].id);
      }
    } catch (err) {
      console.error('Failed to fetch regression data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleRunSuite = async () => {
    setRunningSuite(true);
    try {
      const res = await fetch('/api/regression/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (res.ok) {
        await fetchData();
      }
    } catch (err) {
      console.error('Run regression suite failed:', err);
    } finally {
      setRunningSuite(false);
    }
  };

  const handleFetchDiff = async () => {
    if (!olderRunId || !newerRunId || olderRunId === newerRunId) return;
    try {
      const res = await fetch(`/api/regression/diff?olderId=${olderRunId}&newerId=${newerRunId}`);
      const data = await res.json();
      if (res.ok) {
        setDiff(data.diff);
      }
    } catch (err) {
      console.error('Failed to compute diff:', err);
    }
  };

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTopic) return;
    try {
      const res = await fetch('/api/regression/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: newTaskSubject,
          grade: newTaskGrade,
          topic: newTaskTopic,
          expectedOutcome: newTaskExpected,
        }),
      });
      if (res.ok) {
        setNewTaskTopic('');
        setShowAddTask(false);
        await fetchData();
      }
    } catch (err) {
      console.error('Add task failed:', err);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2.5">
            <TrendingUp className="w-6 h-6 text-indigo-600" />
            {t.regression.title}
          </h1>
          <p className="text-sm text-gray-700 mt-1">{t.regression.subtitle}</p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowAddTask(true)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-50 flex items-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Ավելացնել առաջադրանք
          </button>
          <button
            disabled={runningSuite}
            onClick={handleRunSuite}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-xs font-semibold hover:bg-indigo-700 transition-colors shadow-xs disabled:opacity-50"
          >
            {runningSuite ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            {t.regression.runSuiteBtn} ({tasks.length} առաջադրանք)
          </button>
        </div>
      </div>

      {/* Frozen Tasks List */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-xs space-y-3">
        <h2 className="text-sm font-bold text-gray-900 flex items-center justify-between">
          <span>{t.regression.frozenTasksTitle} ({tasks.length})</span>
          <span className="text-xs font-normal text-gray-700">
            Չփոփոխվող բազա՝ համակարգի որակական ռեգրեսները բռնելու համար
          </span>
        </h2>

        <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 text-xs">
          {tasks.map((tk) => (
            <div
              key={tk.id}
              className="p-3 flex items-center justify-between gap-3 hover:bg-gray-50/50"
            >
              <div className="flex items-center gap-3">
                <span className="font-mono text-gray-700 text-[11px]">{tk.id}</span>
                <span className="font-semibold text-gray-900">{tk.topic}</span>
                <span className="text-gray-700">
                  ({tk.subject}, {tk.grade}-րդ դաս.)
                </span>
              </div>
              <div>
                <Badge variant={tk.expectedOutcome === 'generate' ? 'pass' : 'warn'}>
                  Ակնկալվող՝ {tk.expectedOutcome === 'generate' ? 'Գեներացիա' : 'Մերժում'}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Regression Runs and Diff View */}
      {runs.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-xs space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-3">
            <h2 className="text-sm font-bold text-gray-900">
              {t.regression.selectDiff}
            </h2>

            {runs.length >= 2 && (
              <div className="flex items-center gap-2 text-xs">
                <select
                  value={olderRunId}
                  onChange={(e) => setOlderRunId(e.target.value)}
                  className="border border-gray-300 rounded p-1.5 bg-white text-xs font-mono"
                >
                  {runs.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.id.substring(0, 10)} ({new Date(r.runDate).toLocaleTimeString()})
                    </option>
                  ))}
                </select>
                <span className="text-gray-700">&rarr;</span>
                <select
                  value={newerRunId}
                  onChange={(e) => setNewerRunId(e.target.value)}
                  className="border border-gray-300 rounded p-1.5 bg-white text-xs font-mono"
                >
                  {runs.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.id.substring(0, 10)} ({new Date(r.runDate).toLocaleTimeString()})
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleFetchDiff}
                  className="px-3 py-1.5 bg-indigo-50 border border-indigo-200 text-indigo-700 font-semibold rounded hover:bg-indigo-100"
                >
                  Հաշվել Diff
                </button>
              </div>
            )}
          </div>

          {/* Diff Result Summary Banner */}
          {diff && (
            <div className="p-4 bg-indigo-50/70 border border-indigo-200 rounded-lg space-y-2 animate-in fade-in">
              <span className="text-xs font-bold text-indigo-950 block">
                {diff.summaryText}
              </span>
              <div className="flex flex-wrap gap-4 text-xs text-indigo-900">
                <span>
                  Ճշգրտության փոփոխություն՝{' '}
                  <strong>{(diff.accuracyChange * 100).toFixed(1)}%</strong>
                </span>
                <span>
                  Latency փոփոխություն՝{' '}
                  <strong>{diff.latencyChange} ms</strong>
                </span>
                <span>
                  FAIL rate փոփոխություն՝{' '}
                  <strong>{(diff.failRateChange * 100).toFixed(1)}%</strong>
                </span>
              </div>
            </div>
          )}

          {/* Latest Run Results Table */}
          <div>
            <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">
              Վերջին փորձարկման արդյունքներ ({runs[runs.length - 1].id})
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-700">
                  <tr>
                    <th className="p-2.5">Առաջադրանք</th>
                    <th className="p-2.5">Ակնկալվող</th>
                    <th className="p-2.5">Փաստացի</th>
                    <th className="p-2.5">Անհիմն փաստեր</th>
                    <th className="p-2.5">FAIL մասնաբաժին</th>
                    <th className="p-2.5">Տևողություն</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {runs[runs.length - 1].results.map((res) => (
                    <tr key={res.taskId} className="hover:bg-gray-50/50">
                      <td className="p-2.5 font-medium text-gray-900">{res.topic}</td>
                      <td className="p-2.5 font-mono">{res.expectedOutcome}</td>
                      <td className="p-2.5">
                        <Badge variant={res.correct ? 'pass' : 'fail'} size="sm">
                          {res.actualOutcome}
                        </Badge>
                      </td>
                      <td className="p-2.5 font-mono">{res.unsupportedClaimsCount}</td>
                      <td className="p-2.5 font-mono">{(res.failRate * 100).toFixed(0)}%</td>
                      <td className="p-2.5 font-mono">{(res.latencyMs / 1000).toFixed(1)}s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Add Task Modal */}
      {showAddTask && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <form
            onSubmit={handleAddTask}
            className="bg-white rounded-xl shadow-xl border border-gray-200 max-w-md w-full p-6 space-y-4"
          >
            <h3 className="text-base font-bold text-gray-900">
              Ավելացնել առաջադրանք սառեցված բազայում
            </h3>
            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-gray-700 mb-1">Թեմա *</label>
                <input
                  type="text"
                  required
                  value={newTaskTopic}
                  onChange={(e) => setNewTaskTopic(e.target.value)}
                  className="w-full border border-gray-300 rounded p-2 text-xs"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-medium text-gray-700 mb-1">Առարկա</label>
                  <input
                    type="text"
                    value={newTaskSubject}
                    onChange={(e) => setNewTaskSubject(e.target.value)}
                    className="w-full border border-gray-300 rounded p-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block font-medium text-gray-700 mb-1">Դասարան</label>
                  <input
                    type="number"
                    value={newTaskGrade}
                    onChange={(e) => setNewTaskGrade(Number(e.target.value))}
                    className="w-full border border-gray-300 rounded p-2 text-xs"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium text-gray-700 mb-1">
                  Ակնկալվող ելք (Expected Outcome)
                </label>
                <select
                  value={newTaskExpected}
                  onChange={(e) => setNewTaskExpected(e.target.value as 'generate' | 'refuse')}
                  className="w-full border border-gray-300 rounded p-2 text-xs bg-white"
                >
                  <option value="generate">Գեներացիա (Ծածկված թեմա)</option>
                  <option value="refuse">Մերժում (Անբավարար ծածկույթ)</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowAddTask(false)}
                className="px-3 py-1.5 border border-gray-300 rounded text-xs"
              >
                Չեղարկել
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-indigo-600 text-white rounded text-xs font-semibold"
              >
                Պահպանել
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
