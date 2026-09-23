import React, { useState, useEffect } from 'react';
import { Sliders, Plus, Trash2, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { Language, MethodRule } from '../../shared/types';
import { Badge } from '../components/Badge';
import { translations } from '../i18n/translations';

interface RulesPageProps {
  lang: Language;
}

export const RulesPage: React.FC<RulesPageProps> = ({ lang }) => {
  const t = translations[lang];

  const [rules, setRules] = useState<MethodRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);

  // New rule form
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [kind, setKind] = useState<MethodRule['kind']>('deterministic');
  const [severity, setSeverity] = useState<MethodRule['severity']>('warning');

  const fetchRules = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/rules');
      const data = await res.json();
      setRules(data.rules || []);
    } catch (err) {
      console.error('Failed to load rules:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRules();
  }, []);

  const handleToggleRule = async (ruleId: string, currentActive: boolean) => {
    try {
      await fetch(`/api/rules/${ruleId}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !currentActive }),
      });
      setRules((prev) =>
        prev.map((r) => (r.id === ruleId ? { ...r, active: !currentActive } : r))
      );
    } catch (err) {
      console.error('Failed to toggle rule:', err);
    }
  };

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !description) return;
    try {
      const res = await fetch('/api/rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description, kind, severity }),
      });
      if (res.ok) {
        setTitle('');
        setDescription('');
        setShowAddModal(false);
        await fetchRules();
      }
    } catch (err) {
      console.error('Failed to create rule:', err);
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (!confirm('Հեռացնե՞լ մեթոդական կանոնը:')) return;
    try {
      await fetch(`/api/rules/${ruleId}`, { method: 'DELETE' });
      setRules((prev) => prev.filter((r) => r.id !== ruleId));
    } catch (err) {
      console.error('Failed to delete rule:', err);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-gray-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2.5">
            <Sliders className="w-6 h-6 text-indigo-600" />
            {t.rules.title}
          </h1>
          <p className="text-sm text-gray-700 mt-1">{t.rules.subtitle}</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors shadow-xs"
        >
          <Plus className="w-4 h-4" />
          {t.rules.newRule}
        </button>
      </div>

      {/* Rules list */}
      <div className="grid grid-cols-1 gap-4">
        {rules.map((rule) => (
          <div
            key={rule.id}
            className={`p-5 rounded-xl border bg-white transition-all ${
              rule.active
                ? 'border-gray-200 shadow-xs'
                : 'border-gray-200 bg-gray-50/60 opacity-60'
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
              <div className="space-y-1.5 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-gray-700 bg-gray-100 px-2 py-0.5 rounded font-semibold">
                    {rule.id}
                  </span>
                  <Badge variant={rule.kind === 'deterministic' ? 'neutral' : 'info'}>
                    {rule.kind === 'deterministic' ? 'Դետերմինիստիկ' : 'LLM-Judged'}
                  </Badge>
                  <Badge variant={rule.severity === 'error' ? 'fail' : 'warn'}>
                    {rule.severity.toUpperCase()}
                  </Badge>
                  <Badge variant={rule.active ? 'pass' : 'neutral'}>
                    {rule.active ? 'ԱԿՏԻՎ Է' : 'ԱՆՋԱՏՎԱԾ'}
                  </Badge>
                </div>

                <h3 className="text-base font-semibold text-gray-900">{rule.title}</h3>
                <p className="text-xs text-gray-600 leading-relaxed">{rule.description}</p>

                {rule.params && Object.keys(rule.params).length > 0 && (
                  <div className="mt-2 text-xs font-mono text-gray-700 bg-gray-50 p-2 rounded border border-gray-100">
                    Պարամետրեր: {JSON.stringify(rule.params)}
                  </div>
                )}
              </div>

              {/* Toggle switch & Delete */}
              <div className="flex items-center gap-3 shrink-0 pt-1">
                <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-gray-700">
                  <input
                    type="checkbox"
                    checked={rule.active}
                    onChange={() => handleToggleRule(rule.id, rule.active)}
                    className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                  />
                  <span>{rule.active ? 'Միացված' : 'Անջատված'}</span>
                </label>

                <button
                  onClick={() => handleDeleteRule(rule.id)}
                  className="p-1.5 text-gray-400 hover:text-rose-600 rounded-lg hover:bg-rose-50"
                  title={t.common.delete}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Add Rule Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <form
            onSubmit={handleCreateRule}
            className="bg-white rounded-xl shadow-xl border border-gray-200 max-w-lg w-full p-6 space-y-4 animate-in fade-in duration-150"
          >
            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-indigo-600" />
              {t.rules.newRule}
            </h3>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-gray-700 mb-1">
                  {t.rules.ruleTitle} *
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="օր. Բաց հարցերի ստուգաթերթիկի պահանջ"
                  className="w-full border border-gray-300 rounded-lg p-2.5 text-xs text-gray-900 outline-hidden focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block font-medium text-gray-700 mb-1">
                  {t.rules.description} *
                </label>
                <textarea
                  required
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Նկարագրեք մեթոդական պահանջը և ստուգման տրամաբանությունը..."
                  className="w-full border border-gray-300 rounded-lg p-2.5 text-xs text-gray-900 outline-hidden focus:ring-1 focus:ring-indigo-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-gray-700 mb-1">
                    {t.rules.kind}
                  </label>
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value as MethodRule['kind'])}
                    className="w-full border border-gray-300 rounded-lg p-2.5 text-xs text-gray-900 outline-hidden bg-white"
                  >
                    <option value="deterministic">Դետերմինիստիկ (Deterministic)</option>
                    <option value="llm_judged">LLM-Judged (Անկախ դատավոր)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-medium text-gray-700 mb-1">
                    {t.rules.severity}
                  </label>
                  <select
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value as MethodRule['severity'])}
                    className="w-full border border-gray-300 rounded-lg p-2.5 text-xs text-gray-900 outline-hidden bg-white"
                  >
                    <option value="warning">Warning (Զգուշացում)</option>
                    <option value="error">Error (Խախտում / Կրիտիկական)</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-gray-100">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                {t.common.cancel}
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700"
              >
                {t.common.save}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
