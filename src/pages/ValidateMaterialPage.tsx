import React, { useState } from 'react';
import {
  Search,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileText,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { Language, MaterialValidationReport, Source } from '../../shared/types';
import { Badge } from '../components/Badge';
import { translations } from '../i18n/translations';

interface ValidateMaterialPageProps {
  lang: Language;
}

export const ValidateMaterialPage: React.FC<ValidateMaterialPageProps> = ({ lang }) => {
  const t = translations[lang];

  const [subject, setSubject] = useState('Բնագիտություն');
  const [grade, setGrade] = useState(5);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [report, setReport] = useState<MaterialValidationReport | null>(null);

  const sampleMaterial = `1. Ի՞նչ են կոչվում բույսերի բջիջներում գտնվող այն օրգանոիդները, որտեղ տեղի է ունենում լուսասինթեզ:
Ա) Միտոքոնդրիումներ
Բ) Քլորոպլաստներ
Գ) Ռիբոսոմներ
Ճիշտ պատասխան՝ Բ

2. Քվանտային համակարգիչներում տեղեկատվության պահպանման հիմնական միավորը կյուբիթն է, որը գործում է սուպերպոզիցիայի սկզբունքով:
Ճիշտ պատասխան՝ Այո

3. Լուսասինթեզի ընթացքում բույսերը կլանում են ածխաթթու գազ և ջուր՝ արտադրելով գլյուկոզ և անջատելով թթվածին:
Ճիշտ պատասխան՝ Ճիշտ է`;

  const handleValidate = async () => {
    if (!text.trim()) return;
    setLoading(true);
    setErrorMsg(null);
    setReport(null);

    try {
      const res = await fetch('/api/validate-material', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject,
          grade: Number(grade),
          text,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Ստուգման սխալ');
      }

      setReport(data.report);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      {/* Header */}
      <div className="border-b border-gray-200 pb-5">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2.5">
          <Search className="w-6 h-6 text-indigo-600" />
          {t.validateMaterial.title}
        </h1>
        <p className="text-sm text-gray-700 mt-1">{t.validateMaterial.subtitle}</p>
      </div>

      {/* Input Form */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-xs p-6 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="block font-medium text-gray-700 mb-1">
              {t.common.subject} *
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
              {t.common.grade} *
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
        </div>

        <div className="text-xs">
          <div className="flex items-center justify-between mb-1">
            <label className="font-medium text-gray-700">
              Ստուգվող նյութի կամ թեստի տեքստը *
            </label>
            <button
              type="button"
              onClick={() => setText(sampleMaterial)}
              className="text-xs text-indigo-600 hover:text-indigo-800 font-medium"
            >
              Տեղադրել օրինակ տեքստ
            </button>
          </div>
          <textarea
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t.validateMaterial.pastePlaceholder}
            className="w-full border border-gray-300 rounded-lg p-3 text-xs text-gray-900 outline-hidden focus:ring-1 focus:ring-indigo-500 font-mono"
          />
        </div>

        {errorMsg && (
          <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800">
            {errorMsg}
          </div>
        )}

        <button
          type="button"
          disabled={loading || !text.trim()}
          onClick={handleValidate}
          className="w-full bg-indigo-600 text-white py-3 rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors shadow-xs flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {loading ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Ստուգվում է պաշտոնական աղբյուրների և մեթոդական կանոնների հետ...</span>
            </>
          ) : (
            <>
              <Search className="w-4 h-4" />
              <span>{t.validateMaterial.analyzeBtn}</span>
            </>
          )}
        </button>
      </div>

      {/* Report View */}
      {report && (
        <div className="space-y-6 animate-in fade-in">
          {/* Summary Metrics */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 shadow-xs">
            <h3 className="text-base font-bold text-gray-900 mb-3">
              {t.validateMaterial.summary}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3.5 bg-rose-50/70 border border-rose-200 rounded-lg">
                <span className="text-xs text-rose-800 block">
                  {t.validateMaterial.unsupportedCount}
                </span>
                <span className="text-xl font-bold text-rose-900 mt-1 block">
                  {report.unsupportedClaimsCount} / {report.totalClaims}
                </span>
              </div>
              <div className="p-3.5 bg-amber-50/70 border border-amber-200 rounded-lg">
                <span className="text-xs text-amber-800 block">
                  {t.validateMaterial.outOfScopeCount}
                </span>
                <span className="text-xl font-bold text-amber-900 mt-1 block">
                  {report.outOfScopeClaimsCount}
                </span>
              </div>
              <div className="p-3.5 bg-indigo-50/70 border border-indigo-200 rounded-lg">
                <span className="text-xs text-indigo-800 block">
                  {t.validateMaterial.ruleViolations}
                </span>
                <span className="text-xl font-bold text-indigo-900 mt-1 block">
                  {report.ruleViolationsCount}
                </span>
              </div>
            </div>
          </div>

          {/* Claims List */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold text-gray-900">
              Մանրամասն պնդումների վերլուծություն ({report.claims.length})
            </h4>

            {report.claims.map((c, idx) => (
              <div
                key={idx}
                className="bg-white rounded-xl border border-gray-200 p-5 shadow-xs space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-semibold text-gray-700 bg-gray-100 px-2 py-0.5 rounded">
                        Հարց #{idx + 1}
                      </span>
                      <Badge
                        variant={
                          c.supportStatus === 'supported'
                            ? 'pass'
                            : c.supportStatus === 'partially_supported'
                            ? 'warn'
                            : 'fail'
                        }
                      >
                        {c.supportStatus === 'supported'
                          ? 'ՀԻՄՆԱՎՈՐՎԱԾ Է'
                          : c.supportStatus === 'partially_supported'
                          ? 'ՄԱՍԱՄԲ ՀԻՄՆԱՎՈՐՎԱԾ'
                          : 'ԱՆՀԻՄՆ ՓԱՍՏ'}
                      </Badge>
                      {!c.gradeAppropriate && (
                        <Badge variant="warn">ԱՅԼ ԴԱՍԱՐԱՆԻ ԾՐԱԳԻՐ</Badge>
                      )}
                    </div>
                    <p className="text-sm font-medium text-gray-900 pt-1">
                      {c.originalText}
                    </p>
                  </div>
                </div>

                {/* Reason & Source Match */}
                <div className="text-xs space-y-1.5 pt-1 border-t border-gray-100 text-gray-700">
                  <p className="leading-relaxed">{c.reason}</p>
                  {c.matchedSourceTitle && (
                    <div className="flex items-center gap-2 font-mono text-[11px] text-indigo-700 bg-indigo-50/50 p-2 rounded border border-indigo-100">
                      <FileText className="w-3.5 h-3.5" />
                      <span>
                        Համապատասխանեցված աղբյուր՝ <strong>{c.matchedSourceTitle}</strong> (հատված: {c.matchedChunkId})
                      </span>
                    </div>
                  )}
                </div>

                {/* Checks */}
                {c.checks && c.checks.length > 0 && (
                  <div className="space-y-1 pt-1">
                    {c.checks.map((chk, i) => (
                      <div
                        key={i}
                        className="text-[11px] flex items-center gap-2 text-gray-600"
                      >
                        {chk.result === 'pass' ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        ) : chk.result === 'warn' ? (
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                        )}
                        <span>{chk.label}:</span>
                        <span className="text-gray-900">{chk.detail}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
