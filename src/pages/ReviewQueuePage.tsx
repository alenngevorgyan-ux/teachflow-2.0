import React, { useState, useEffect } from 'react';
import { Inbox, AlertTriangle, XCircle, ArrowRight, ShieldCheck } from 'lucide-react';
import { Assessment, AssessmentItem, ItemTrace, Language } from '../../shared/types';
import { Badge } from '../components/Badge';
import { ItemTraceModal } from '../components/ItemTraceModal';
import { translations } from '../i18n/translations';

interface ReviewQueuePageProps {
  lang: Language;
  onNavigateToAssessment: (id: string) => void;
}

export const ReviewQueuePage: React.FC<ReviewQueuePageProps> = ({
  lang,
  onNavigateToAssessment,
}) => {
  const t = translations[lang];

  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTraceItem, setSelectedTraceItem] = useState<{
    item: AssessmentItem;
    trace?: ItemTrace;
  } | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch('/api/assessments')
      .then((r) => r.json())
      .then((data) => setAssessments(data.assessments || []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Collect all flagged items across assessments
  const flaggedItems: {
    assessmentId: string;
    topic: string;
    item: AssessmentItem;
    trace: ItemTrace;
  }[] = [];

  for (const a of assessments) {
    for (const item of a.items) {
      const trace = a.traces.find((tr) => tr.itemId === item.id);
      if (trace && (trace.status === 'WARN' || trace.status === 'FAIL')) {
        flaggedItems.push({
          assessmentId: a.id,
          topic: a.topic,
          item,
          trace,
        });
      }
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* Header */}
      <div className="border-b border-gray-200 pb-5">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2.5">
          <Inbox className="w-6 h-6 text-indigo-600" />
          {t.reviewQueue.title} ({flaggedItems.length})
        </h1>
        <p className="text-sm text-gray-700 mt-1">{t.reviewQueue.subtitle}</p>
      </div>

      {flaggedItems.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center space-y-2">
          <ShieldCheck className="w-8 h-8 text-emerald-600 mx-auto" />
          <h3 className="text-base font-semibold text-gray-900">
            Ստուգման հերթը դատարկ է
          </h3>
          <p className="text-xs text-gray-700">
            Բոլոր գեներացված հարցերը հաջողությամբ անցել են վալիդատորի բոլոր ստուգումները:
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {flaggedItems.map(({ assessmentId, topic, item, trace }, idx) => (
            <div
              key={`${assessmentId}-${item.id}-${idx}`}
              className="bg-white rounded-xl border border-gray-200 p-5 shadow-xs space-y-3"
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="space-y-1.5 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-mono font-semibold text-gray-700 bg-gray-100 px-2 py-0.5 rounded">
                      {item.id}
                    </span>
                    <Badge variant={trace.status === 'FAIL' ? 'fail' : 'warn'}>
                      {trace.status}
                    </Badge>
                    {trace.judgeProviderId && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 font-mono">
                        Judge: {trace.judgeProviderId}
                      </span>
                    )}
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 font-mono font-medium">
                      Conf: {trace.confidence !== undefined && trace.confidence !== null ? `${(trace.confidence * 100).toFixed(0)}%` : 'n/a'}
                    </span>
                    <span className="text-xs text-gray-700 font-medium">
                      Թեստ՝ «{topic}»
                    </span>
                  </div>

                  <p className="text-sm font-medium text-gray-900">{item.stem}</p>

                  <div className="space-y-1 pt-1">
                    {trace.checks
                      .filter((c) => c.result !== 'pass')
                      .map((c, i) => (
                        <div
                          key={i}
                          className="text-xs flex items-center gap-2 text-rose-700 bg-rose-50/70 p-2 rounded border border-rose-100"
                        >
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            <strong>{c.label}:</strong> {c.detail}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 pt-1">
                  <button
                    onClick={() => setSelectedTraceItem({ item, trace })}
                    className="px-3 py-1.5 border border-indigo-200 bg-indigo-50/50 rounded-lg text-xs font-medium text-indigo-700 hover:bg-indigo-100 flex items-center gap-1"
                  >
                    <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
                    Trace
                  </button>

                  <button
                    onClick={() => onNavigateToAssessment(assessmentId)}
                    className="px-3 py-1.5 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-1"
                  >
                    Դիտել թեստը
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

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
