import React from 'react';
import { CheckCircle2, AlertTriangle, XCircle, FileText, Check, Cpu, ShieldCheck, X } from 'lucide-react';
import { AssessmentItem, ItemTrace } from '../../shared/types';
import { Badge } from './Badge';

interface ItemTraceModalProps {
  item: AssessmentItem;
  trace?: ItemTrace;
  onClose: () => void;
  onExportJson?: () => void;
}

export const ItemTraceModal: React.FC<ItemTraceModalProps> = ({
  item,
  trace,
  onClose,
  onExportJson,
}) => {
  if (!trace) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl border border-gray-200 w-full max-w-3xl max-h-[90vh] flex flex-col animate-in fade-in zoom-in-95 duration-150">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50 rounded-t-xl">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-50 rounded-lg text-indigo-700">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-gray-900">
                  Աուդիտորական հետագիծ (Audit Trace)
                </h3>
                <span className="text-xs text-gray-700 font-mono bg-gray-200 px-2 py-0.5 rounded">
                  {item.id}
                </span>
                <Badge
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
              </div>
              <p className="text-xs text-gray-700 mt-0.5">
                Գեներացման ժամանակ՝ {new Date(trace.generatedAt).toLocaleString()}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Content */}
        <div className="p-6 overflow-y-auto space-y-6 text-sm text-gray-700">
          {/* Question Stem summary */}
          <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg">
            <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider block mb-1">
              Առաջադրանքի հարցադրումը ({item.variant} տարբերակ, {item.type}, {item.difficulty})
            </span>
            <p className="text-gray-900 font-medium">{item.stem}</p>
            {item.options && (
              <div className="mt-2 space-y-1">
                {item.options.map((opt, i) => (
                  <div
                    key={i}
                    className={`text-xs px-2.5 py-1 rounded flex items-center gap-2 ${
                      String(item.answerKey).trim() === opt.trim()
                        ? 'bg-emerald-50 text-emerald-800 font-semibold border border-emerald-200'
                        : 'bg-white border border-gray-200 text-gray-600'
                    }`}
                  >
                    <span>{String.fromCharCode(65 + i)}.</span>
                    <span>{opt}</span>
                    {String(item.answerKey).trim() === opt.trim() && (
                      <Check className="w-3.5 h-3.5 text-emerald-600 ml-auto" />
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="mt-2 text-xs text-gray-700 flex items-center gap-4">
              <span>Ճիշտ պատասխան՝ <strong className="text-emerald-700">{String(item.answerKey)}</strong></span>
              <span>Չափորոշչային կոդեր՝ <strong className="text-indigo-700">{item.outcomeCodes.join(', ') || 'N/A'}</strong></span>
            </div>
          </div>

          {/* Model, Judge and Policy Environment */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <div className="p-3 border border-gray-200 rounded-lg bg-white">
              <span className="text-xs text-gray-700 block">Գեներացման մոդել</span>
              <span className="font-mono text-xs font-medium text-gray-900 flex items-center gap-1 mt-0.5">
                <Cpu className="w-3.5 h-3.5 text-indigo-500" />
                {trace.modelId}
              </span>
            </div>
            <div className="p-3 border border-gray-200 rounded-lg bg-white">
              <span className="text-xs text-gray-700 block">Դատավոր (Judge)</span>
              <span className="text-xs font-semibold text-indigo-900 capitalize mt-0.5 block truncate">
                {trace.judgeProviderId === 'typesafe_jev' ? 'TypeSafe Jev' : 'Gemini Judge'}
              </span>
            </div>
            <div className="p-3 border border-gray-200 rounded-lg bg-white">
              <span className="text-xs text-gray-700 block">Դատավորի վստահություն</span>
              <span className="font-mono text-xs font-bold text-gray-900 mt-0.5 block">
                {trace.confidence !== undefined && trace.confidence !== null ? `${(trace.confidence * 100).toFixed(0)}%` : 'n/a'}
              </span>
            </div>
            <div className="p-3 border border-gray-200 rounded-lg bg-white col-span-2">
              <span className="text-xs text-gray-700 block">Քաղաքականության հեշ (Policy Hash)</span>
              <span className="font-mono text-xs font-medium text-gray-900 mt-0.5 block truncate">
                {trace.policyVersion}
              </span>
            </div>
          </div>

          {/* Fact Source Citations with Verbatim Highlight */}
          <div>
            <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <FileText className="w-4 h-4 text-indigo-600" />
              Հղված պաշտոնական ՓԱՍՏԱՑԻ աղբյուրներ և բառացի մեջբերումներ
            </h4>
            <div className="space-y-3">
              {item.citations.map((cit, idx) => {
                const srcRef = trace.factSources.find((s) => s.chunkId === cit.chunkId);
                return (
                  <div
                    key={idx}
                    className="p-3.5 rounded-lg border border-indigo-100 bg-indigo-50/40 text-xs space-y-2"
                  >
                    <div className="flex items-center justify-between font-mono text-gray-700">
                      <span>
                        Հատված (Chunk ID): <strong>{cit.chunkId}</strong>
                      </span>
                      {srcRef?.page && <span>Էջ՝ {srcRef.page}</span>}
                    </div>
                    <div className="bg-white p-2.5 rounded border border-indigo-200 text-gray-900">
                      <span className="text-[11px] font-semibold text-indigo-900 block mb-1">
                        Բառացի մեջբերում աղբյուրից (Verbatim Quote):
                      </span>
                      <blockquote className="italic border-l-2 border-indigo-500 pl-2 text-indigo-950 font-medium">
                        «{cit.quote}»
                      </blockquote>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Validation Checks Table */}
          <div>
            <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wider mb-2">
              Անկախ ստուգումների արդյունքներ (Verification Checks)
            </h4>
            <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 overflow-hidden bg-white">
              {trace.checks.map((chk, i) => (
                <div key={i} className="p-3 flex items-start gap-3 text-xs">
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
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-gray-900">{chk.label}</span>
                      <span className="text-[10px] text-gray-700 font-mono">
                        ({chk.kind})
                      </span>
                      {chk.judgeProviderId && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-mono">
                          Judge: {chk.judgeProviderId}
                        </span>
                      )}
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 font-mono font-medium">
                        Conf: {chk.confidence !== undefined && chk.confidence !== null ? `${(chk.confidence * 100).toFixed(0)}%` : 'n/a'}
                      </span>
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
                    <p className="text-gray-600 mt-1">{chk.detail}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3 border-t border-gray-200 bg-gray-50 flex items-center justify-between rounded-b-xl">
          <button
            onClick={() => {
              const blob = new Blob([JSON.stringify(trace, null, 2)], {
                type: 'application/json',
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `trace-${item.id}.json`;
              a.click();
            }}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-800 flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-200 bg-white hover:bg-indigo-50 transition-colors"
          >
            Արտահանել հետագիծը (JSON)
          </button>
          <button
            onClick={onClose}
            className="text-xs font-medium text-gray-700 hover:text-gray-900 px-4 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-100 transition-colors"
          >
            Փակել
          </button>
        </div>
      </div>
    </div>
  );
};
