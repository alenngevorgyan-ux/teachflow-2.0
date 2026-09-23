import React, { useState, useEffect } from 'react';
import {
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  BookOpen,
  ArrowRight,
  RefreshCw,
  Eye,
  Info,
} from 'lucide-react';
import { Assessment, Language, Source } from '../../shared/types';
import { Badge } from '../components/Badge';
import { translations } from '../i18n/translations';

interface GeneratePageProps {
  lang: Language;
  onViewAssessment: (assessmentId: string) => void;
}

export const GeneratePage: React.FC<GeneratePageProps> = ({
  lang,
  onViewAssessment,
}) => {
  const t = translations[lang];

  const [sources, setSources] = useState<Source[]>([]);
  const [subject, setSubject] = useState('Բնագիտություն');
  const [grade, setGrade] = useState(5);
  const [topic, setTopic] = useState('');
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [modelId, setModelId] = useState('gemini-3.8-flash');

  const [loading, setLoading] = useState(false);
  const [pipelinePhase, setPipelinePhase] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [lastGeneratedAssessment, setLastGeneratedAssessment] = useState<Assessment | null>(null);

  useEffect(() => {
    fetch('/api/sources')
      .then((r) => r.json())
      .then((data) => {
        const active = (data.sources || []).filter((s: Source) => s.status === 'active');
        setSources(active);
        setSelectedSourceIds(active.map((s: Source) => s.id));
      })
      .catch(console.error);
  }, []);

  const eligibleSources = sources.filter(
    (s) => s.subject.toLowerCase() === subject.toLowerCase() && s.grades.includes(Number(grade))
  );

  const handleSelectPreset = (type: 'demo' | 'uncovered') => {
    if (type === 'demo') {
      setSubject('Բնագիտություն');
      setGrade(5);
      setTopic('Լուսասինթեզի ընթացքը, քլորոպլաստները և թթվածնի անջատումը');
    } else {
      setSubject('Բնագիտություն');
      setGrade(5);
      setTopic('Քվանտային կոմպյուտերներ և սուպերհաղորդականություն');
    }
  };

  const handleGenerate = async (generateOnlyCoveredPart = false) => {
    if (!topic.trim()) return;
    setLoading(true);
    setErrorMsg(null);
    setLastGeneratedAssessment(null);

    setPipelinePhase('Փուլ 1. Հատվածների որոնում (Retrieval)...');
    setTimeout(() => {
      setPipelinePhase('Փուլ 2. Ծածկույթի ստուգում (Coverage Gate)...');
    }, 1200);

    try {
      const res = await fetch('/api/assessments/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject,
          grade: Number(grade),
          topic,
          selectedSourceIds: selectedSourceIds.length > 0 ? selectedSourceIds : undefined,
          modelId,
          generateOnlyCoveredPart,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Գեներացիայի սխալ');
      }

      setLastGeneratedAssessment(data.assessment);
      if (data.assessment.status !== 'refused') {
        onViewAssessment(data.assessment.id);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
    } finally {
      setLoading(false);
      setPipelinePhase('');
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      {/* Header */}
      <div className="border-b border-gray-200 pb-5">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2.5">
          <Sparkles className="w-6 h-6 text-indigo-600" />
          {t.generate.title}
        </h1>
        <p className="text-sm text-gray-700 mt-1">{t.generate.subtitle}</p>
      </div>

      {/* Generation Form */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-xs p-6 space-y-6">
        {/* Presets */}
        <div className="space-y-2">
          <span className="text-xs font-semibold text-gray-700 uppercase tracking-wider block">
            Արագ փորձարկման օրինակներ (Presets)
          </span>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => handleSelectPreset('demo')}
              className="text-xs px-3 py-1.5 rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-800 font-medium hover:bg-indigo-100 transition-colors text-left"
            >
              ✅ {t.generate.presetDemo}
            </button>
            <button
              type="button"
              onClick={() => handleSelectPreset('uncovered')}
              className="text-xs px-3 py-1.5 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 font-medium hover:bg-amber-100 transition-colors text-left"
            >
              ⚠️ {t.generate.presetUncovered}
            </button>
          </div>
        </div>

        {/* Form Inputs */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div>
            <label className="block font-medium text-gray-700 mb-1">
              {t.common.subject} *
            </label>
            <input
              type="text"
              required
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
              required
              value={grade}
              onChange={(e) => setGrade(Number(e.target.value))}
              className="w-full border border-gray-300 rounded-lg p-2.5 text-xs text-gray-900 outline-hidden focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block font-medium text-gray-700 mb-1">
              AI Մոդել (Provider)
            </label>
            <select
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2.5 text-xs text-gray-900 outline-hidden bg-white"
            >
              <option value="gemini-3.8-flash">Google Gemini 3.8 Flash (Ակտիվ)</option>
            </select>
          </div>
        </div>

        {/* Topic input */}
        <div className="text-xs">
          <label className="block font-medium text-gray-700 mb-1">
            {t.generate.enterTopic} *
          </label>
          <textarea
            required
            rows={3}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Մուտքագրեք ստուգվող թեման կամ ենթաթեման..."
            className="w-full border border-gray-300 rounded-lg p-3 text-xs text-gray-900 outline-hidden focus:ring-1 focus:ring-indigo-500"
          />
        </div>

        {/* Source selection */}
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider">
            {t.generate.selectSources} ({eligibleSources.length} համապատասխանող աղբյուր)
          </label>

          {eligibleSources.length === 0 ? (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
              Այս դասարանի և առարկայի համար դեռևս ակտիվ աղբյուրներ գրանցված չեն: Ավելացրեք դրանք «Աղբյուրների ռեգիստր» բաժնում:
            </div>
          ) : (
            <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-48 overflow-y-auto bg-gray-50/50">
              {eligibleSources.map((src) => {
                const isSelected = selectedSourceIds.includes(src.id);
                return (
                  <label
                    key={src.id}
                    className="flex items-center gap-3 p-2.5 text-xs hover:bg-white cursor-pointer transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedSourceIds([...selectedSourceIds, src.id]);
                        } else {
                          setSelectedSourceIds(selectedSourceIds.filter((id) => id !== src.id));
                        }
                      }}
                      className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-gray-900 truncate">
                          {src.title}
                        </span>
                        <Badge
                          size="sm"
                          variant={src.role === 'FACT' ? 'pass' : 'warn'}
                        >
                          {src.role}
                        </Badge>
                        <span className="text-[10px] font-mono text-gray-700">
                          v{src.version}
                        </span>
                      </div>
                    </div>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        {/* Error message */}
        {errorMsg && (
          <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold block">Սխալ գեներացիայի ընթացքում</span>
              <p className="mt-0.5">{errorMsg}</p>
            </div>
          </div>
        )}

        {/* Generation Action Button */}
        <div className="pt-2">
          <button
            type="button"
            disabled={loading || !topic.trim()}
            onClick={() => handleGenerate(false)}
            className="w-full bg-indigo-600 text-white py-3 rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors shadow-xs flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>{pipelinePhase || t.generate.generatingNotice}</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>{t.generate.generateBtn}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Refusal Card (Coverage Gate result) */}
      {lastGeneratedAssessment?.status === 'refused' && (
        <div className="bg-amber-50/70 border border-amber-300 rounded-xl p-6 space-y-4 animate-in fade-in">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-amber-100 rounded-lg text-amber-800 shrink-0">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div className="space-y-1.5 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-amber-950">
                  {t.generate.refusalAlert}
                </h3>
                <Badge variant="fail">{t.common.refused}</Badge>
              </div>
              <p className="text-sm text-amber-900 leading-relaxed font-medium">
                {lastGeneratedAssessment.refusalReason}
              </p>
            </div>
          </div>

          {lastGeneratedAssessment.coverage?.missingAspects &&
            lastGeneratedAssessment.coverage.missingAspects.length > 0 && (
              <div className="bg-white/80 p-4 rounded-lg border border-amber-200 text-xs space-y-1.5">
                <span className="font-semibold text-amber-950 block">
                  Աղբյուրներում բացակայող ասպեկտներ՝
                </span>
                <ul className="list-disc list-inside text-amber-900 space-y-0.5">
                  {lastGeneratedAssessment.coverage.missingAspects.map((aspect, idx) => (
                    <li key={idx}>{aspect}</li>
                  ))}
                </ul>
              </div>
            )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <span className="text-xs text-gray-700">
              TeachFlow-ը երբեք չի հորինում փաստեր առանց պաշտոնական աղբյուրի:
            </span>
            <button
              onClick={() => handleGenerate(true)}
              className="text-xs font-semibold px-4 py-2 rounded-lg bg-amber-600 text-white hover:bg-amber-700 transition-colors shadow-xs"
            >
              {t.generate.generateCoveredOnly}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
