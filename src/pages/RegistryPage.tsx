import React, { useState, useEffect } from 'react';
import {
  Upload,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  RefreshCw,
  Plus,
  Sparkles,
  BookOpen,
  ArrowRightLeft,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { CurriculumOutcome, Language, Source } from '../../shared/types';
import { Badge } from '../components/Badge';
import { translations } from '../i18n/translations';

interface EnrichedSource extends Source {
  usageCount?: number;
}

interface RegistryPageProps {
  lang: Language;
}

export const RegistryPage: React.FC<RegistryPageProps> = ({ lang }) => {
  const t = translations[lang];

  const [sources, setSources] = useState<EnrichedSource[]>([]);
  const [outcomes, setOutcomes] = useState<CurriculumOutcome[]>([]);
  const [loading, setLoading] = useState(false);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [embeddingWarning, setEmbeddingWarning] = useState<string | null>(null);
  const [supersedeModalSource, setSupersedeModalSource] = useState<Source | null>(null);
  const [expandedSourceId, setExpandedSourceId] = useState<string | null>(null);

  // Form states
  const [title, setTitle] = useState('');
  const [authority, setAuthority] = useState('');
  const [docType, setDocType] = useState<Source['docType']>('textbook');
  const [subject, setSubject] = useState('Բնագիտություն');
  const [grades, setGrades] = useState('5');
  const [role, setRole] = useState<Source['role']>('FACT');
  const [version, setVersion] = useState('1.0');
  const [content, setContent] = useState('');
  const [isOcr, setIsOcr] = useState(false);

  // Supersede modal state
  const [newVersionStr, setNewVersionStr] = useState('');
  const [supersedeContent, setSupersedeContent] = useState('');

  // Extract outcomes modal
  const [outcomeSourceId, setOutcomeSourceId] = useState<string | null>(null);
  const [extractingOutcomes, setExtractingOutcomes] = useState(false);

  const fetchSourcesAndOutcomes = async () => {
    setLoading(true);
    try {
      const [srcRes, outRes] = await Promise.all([
        fetch('/api/sources').then((r) => r.json()),
        fetch('/api/outcomes').then((r) => r.json()),
      ]);
      setSources(srcRes.sources || []);
      setOutcomes(outRes.outcomes || []);
    } catch (err) {
      console.error('Failed to load sources:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSourcesAndOutcomes();
  }, []);

  const handleCreateSource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !content) return;

    setLoading(true);
    try {
      const res = await fetch('/api/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          authority,
          docType,
          subject,
          grades: grades.split(',').map((s) => Number(s.trim())),
          role,
          version,
          text: content,
          isOcr,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setTitle('');
        setAuthority('');
        setContent('');
        setShowUploadForm(false);
        setEmbeddingWarning(data.embeddingWarning || null);
        await fetchSourcesAndOutcomes();
      }
    } catch (err) {
      console.error('Create source failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSupersede = async () => {
    if (!supersedeModalSource || !newVersionStr) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/sources/${supersedeModalSource.id}/supersede`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newVersion: newVersionStr,
          text: supersedeContent || undefined,
        }),
      });
      if (res.ok) {
        setSupersedeModalSource(null);
        setNewVersionStr('');
        setSupersedeContent('');
        await fetchSourcesAndOutcomes();
      }
    } catch (err) {
      console.error('Supersede failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSource = async (id: string) => {
    if (!confirm('Հաստատու՞մ եք աղբյուրի հեռացումը:')) return;
    setLoading(true);
    try {
      await fetch(`/api/sources/${id}`, { method: 'DELETE' });
      await fetchSourcesAndOutcomes();
    } catch (err) {
      console.error('Delete source failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleExtractOutcomes = async (src: Source) => {
    setOutcomeSourceId(src.id);
    setExtractingOutcomes(true);
    try {
      const textToExtract = src.chunks.map((c) => c.text).join('\n\n');
      const res = await fetch('/api/sources/extract-outcomes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceId: src.id,
          subject: src.subject,
          grade: src.grades[0] || 5,
          text: textToExtract,
        }),
      });
      if (res.ok) {
        await fetchSourcesAndOutcomes();
      }
    } catch (err) {
      console.error('Failed to extract outcomes:', err);
    } finally {
      setExtractingOutcomes(false);
      setOutcomeSourceId(null);
    }
  };

  const handleConfirmOutcome = async (code: string, confirmed: boolean) => {
    try {
      await fetch('/api/outcomes/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, confirmed }),
      });
      setOutcomes((prev) =>
        prev.map((o) => (o.code === code ? { ...o, confirmed } : o))
      );
    } catch (err) {
      console.error('Failed to confirm outcome:', err);
    }
  };

  const handleDeleteOutcome = async (code: string) => {
    try {
      await fetch(`/api/outcomes/${code}`, { method: 'DELETE' });
      setOutcomes((prev) => prev.filter((o) => o.code !== code));
    } catch (err) {
      console.error('Failed to delete outcome:', err);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-gray-200 pb-5">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2.5">
            <BookOpen className="w-6 h-6 text-indigo-600" />
            {t.registry.title}
          </h1>
          <p className="text-sm text-gray-700 mt-1">{t.registry.subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={fetchSourcesAndOutcomes}
            className="p-2 border border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors"
            title={t.common.refresh}
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowUploadForm(!showUploadForm)}
            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors shadow-xs"
          >
            <Plus className="w-4 h-4" />
            {t.registry.uploadNew}
          </button>
        </div>
      </div>

      {embeddingWarning && (
        <div className="flex items-start justify-between gap-3 p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900">
          <span className="font-medium">{embeddingWarning}</span>
          <button
            onClick={() => setEmbeddingWarning(null)}
            className="shrink-0 text-amber-700 hover:text-amber-900 font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {/* Upload/Add Form Drawer */}
      {showUploadForm && (
        <form
          onSubmit={handleCreateSource}
          className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-5 animate-in fade-in duration-150"
        >
          <div className="flex items-center justify-between border-b border-gray-100 pb-3">
            <h3 className="font-semibold text-gray-900 text-base flex items-center gap-2">
              <Upload className="w-4 h-4 text-indigo-600" />
              {t.registry.uploadNew}
            </h3>
            <button
              type="button"
              onClick={() => setShowUploadForm(false)}
              className="text-xs text-gray-500 hover:text-gray-700"
            >
              {t.common.cancel}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-medium text-gray-700 mb-1">
                {t.registry.sourceTitle} *
              </label>
              <input
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="օր. Բնագիտություն 5-րդ դասարան"
                className="w-full border border-gray-300 rounded-lg p-2.5 text-xs text-gray-900 focus:ring-1 focus:ring-indigo-500 outline-hidden"
              />
            </div>

            <div>
              <label className="block font-medium text-gray-700 mb-1">
                {t.registry.authority}
              </label>
              <input
                type="text"
                value={authority}
                onChange={(e) => setAuthority(e.target.value)}
                placeholder="օր. Հաստատված ուսումնական հանձնաժողովի կողմից"
                className="w-full border border-gray-300 rounded-lg p-2.5 text-xs text-gray-900 focus:ring-1 focus:ring-indigo-500 outline-hidden"
              />
            </div>

            <div>
              <label className="block font-medium text-gray-700 mb-1">
                {t.common.subject}
              </label>
              <input
                type="text"
                required
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full border border-gray-300 rounded-lg p-2.5 text-xs text-gray-900 focus:ring-1 focus:ring-indigo-500 outline-hidden"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block font-medium text-gray-700 mb-1">
                  {t.common.grade}
                </label>
                <input
                  type="text"
                  value={grades}
                  onChange={(e) => setGrades(e.target.value)}
                  placeholder="5"
                  className="w-full border border-gray-300 rounded-lg p-2.5 text-xs text-gray-900 focus:ring-1 focus:ring-indigo-500 outline-hidden"
                />
              </div>
              <div>
                <label className="block font-medium text-gray-700 mb-1">
                  {t.registry.role}
                </label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as Source['role'])}
                  className="w-full border border-gray-300 rounded-lg p-2.5 text-xs text-gray-900 focus:ring-1 focus:ring-indigo-500 outline-hidden bg-white"
                >
                  <option value="FACT">{t.common.fact}</option>
                  <option value="METHOD">{t.common.method}</option>
                  <option value="TEMPLATE">{t.common.template}</option>
                </select>
              </div>
              <div>
                <label className="block font-medium text-gray-700 mb-1">
                  {t.common.version}
                </label>
                <input
                  type="text"
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg p-2.5 text-xs text-gray-900 focus:ring-1 focus:ring-indigo-500 outline-hidden"
                />
              </div>
            </div>
          </div>

          <div className="text-xs">
            <label className="block font-medium text-gray-700 mb-1">
              {t.registry.content} * (Տեքստը կբաժանվի ~800 նիշանոց հատվածների)
            </label>
            <textarea
              required
              rows={6}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Տեղադրեք դասագրքի, չափորոշչի կամ մեթոդական ուղեցույցի բնօրինակ տեքստը..."
              className="w-full border border-gray-300 rounded-lg p-3 text-xs text-gray-900 focus:ring-1 focus:ring-indigo-500 outline-hidden font-mono"
            />
          </div>

          <div className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              id="ocrCheck"
              checked={isOcr}
              onChange={(e) => setIsOcr(e.target.checked)}
              className="rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <label htmlFor="ocrCheck" className="text-gray-700 font-medium cursor-pointer">
              {t.common.ocrNotice}
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setShowUploadForm(false)}
              className="px-4 py-2 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              {t.common.cancel}
            </button>
            <button
              type="submit"
              disabled={loading}
              className="px-5 py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 shadow-xs"
            >
              {t.common.save}
            </button>
          </div>
        </form>
      )}

      {/* Sources List */}
      <div className="space-y-4">
        <h2 className="text-base font-semibold text-gray-900 flex items-center justify-between">
          <span>Գրանցված աղբյուրներ ({sources.length})</span>
          <span className="text-xs font-normal text-gray-700">
            ՓԱՍՏԱՑԻ աղբյուրներ՝ {sources.filter((s) => s.role === 'FACT').length} &bull; Մեթոդական՝{' '}
            {sources.filter((s) => s.role === 'METHOD').length}
          </span>
        </h2>

        <div className="grid grid-cols-1 gap-4">
          {sources.map((src) => {
            const isExpanded = expandedSourceId === src.id;
            return (
              <div
                key={src.id}
                className={`bg-white rounded-xl border transition-all ${
                  src.status === 'superseded'
                    ? 'border-gray-200 opacity-75 bg-gray-50/50'
                    : 'border-gray-200 shadow-xs hover:border-indigo-200'
                }`}
              >
                <div className="p-5">
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                    <div className="space-y-1.5 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {src.isDemo && (
                          <Badge variant="demo">{t.common.demoBadge}</Badge>
                        )}
                        <Badge
                          variant={
                            src.role === 'FACT'
                              ? 'pass'
                              : src.role === 'METHOD'
                              ? 'warn'
                              : 'info'
                          }
                        >
                          {src.role}
                        </Badge>
                        <Badge
                          variant={src.status === 'active' ? 'neutral' : 'superseded'}
                        >
                          {src.status === 'active' ? t.common.active : t.common.superseded}
                        </Badge>
                        {src.ocr && (
                          <Badge variant="warn">OCR</Badge>
                        )}
                        <span className="text-xs font-mono text-gray-700">
                          v{src.version}
                        </span>
                      </div>

                      <h3 className="text-base font-semibold text-gray-900 leading-snug">
                        {src.title}
                      </h3>

                      <div className="flex flex-wrap items-center gap-y-1 gap-x-4 text-xs text-gray-700">
                        <span>
                          Իրավասու մարմին՝ <strong>{src.authority}</strong>
                        </span>
                        <span>
                          Առարկա՝ <strong>{src.subject}</strong>
                        </span>
                        <span>
                          Դասարան(ներ)՝ <strong>{src.grades.join(', ')}</strong>
                        </span>
                        <span>
                          Հատվածներ՝ <strong>{src.chunks.length}</strong>
                        </span>
                        <span>
                          {t.registry.usageCount}՝{' '}
                          <strong className="text-indigo-600">
                            {src.usageCount || 0}
                          </strong>
                        </span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0 pt-1">
                      {src.status === 'active' && (
                        <button
                          onClick={() => {
                            setSupersedeModalSource(src);
                            setNewVersionStr(`${src.version}.1`);
                          }}
                          className="px-2.5 py-1.5 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-100 flex items-center gap-1"
                          title="Փոխարինել նոր տարբերակով (Supersede)"
                        >
                          <ArrowRightLeft className="w-3.5 h-3.5 text-gray-700" />
                          Փոխարինել
                        </button>
                      )}

                      <button
                        disabled={extractingOutcomes && outcomeSourceId === src.id}
                        onClick={() => handleExtractOutcomes(src)}
                        className="px-2.5 py-1.5 border border-indigo-200 bg-indigo-50/50 rounded-lg text-xs font-medium text-indigo-700 hover:bg-indigo-100 flex items-center gap-1"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                        Քաղել վերջնարդյունքները
                      </button>

                      {!src.isDemo && (
                        <button
                          onClick={() => handleDeleteSource(src.id)}
                          className="p-1.5 border border-gray-300 rounded-lg text-gray-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                          title={t.common.delete}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}

                      <button
                        onClick={() => setExpandedSourceId(isExpanded ? null : src.id)}
                        className="p-1.5 border border-gray-300 rounded-lg text-gray-500 hover:bg-gray-100"
                        title="Տեսնել հատվածները"
                      >
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Expanded Chunks list */}
                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
                      <div className="flex items-center justify-between text-xs text-gray-700 font-mono">
                        <span>SHA256: {src.sha256}</span>
                        <span>Գրանցված՝ {new Date(src.uploadedAt).toLocaleDateString()}</span>
                      </div>
                      <div className="space-y-2">
                        {src.chunks.map((ch) => (
                          <div
                            key={ch.id}
                            className="p-3 bg-gray-50 rounded-lg border border-gray-200 text-xs"
                          >
                            <div className="flex items-center justify-between text-[11px] font-mono text-gray-700 mb-1">
                              <span>Հատված: {ch.id}</span>
                              {ch.page && <span>Էջ: {ch.page}</span>}
                            </div>
                            <p className="text-gray-800 leading-relaxed">{ch.text}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Curriculum Outcomes Review Section (Methodologist MUST review & confirm) */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
        <div className="border-b border-gray-200 pb-3">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600" />
            <h2 className="text-base font-bold text-gray-900">
              {t.registry.confirmOutcomesTitle}
            </h2>
          </div>
          <p className="text-xs text-amber-800 bg-amber-50 p-2.5 rounded-lg border border-amber-200 mt-2 font-medium">
            {t.registry.confirmOutcomesNotice}
          </p>
        </div>

        {outcomes.length === 0 ? (
          <p className="text-xs text-gray-700 italic">
            Դեռևս քաղված վերջնարդյունքներ չկան: Սեղմեք «Քաղել վերջնարդյունքները» որևէ աղբյուրի վրա:
          </p>
        ) : (
          <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg overflow-hidden">
            {outcomes.map((out) => (
              <div
                key={out.code}
                className="p-3.5 bg-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
              >
                <div className="space-y-1 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                      {out.code}
                    </span>
                    <span className="text-gray-700">
                      {out.subject}, {out.grade}-րդ դասարան
                    </span>
                    <Badge variant={out.confirmed ? 'pass' : 'warn'} size="sm">
                      {out.confirmed ? t.common.confirm : t.common.unconfirmed}
                    </Badge>
                  </div>
                  <p className="text-gray-900">{out.text}</p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleConfirmOutcome(out.code, !out.confirmed)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      out.confirmed
                        ? 'bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100'
                        : 'bg-emerald-600 text-white hover:bg-emerald-700'
                    }`}
                  >
                    {out.confirmed ? 'Չեղարկել հաստատումը' : 'Հաստատել օգտագործման համար'}
                  </button>
                  <button
                    onClick={() => handleDeleteOutcome(out.code)}
                    className="p-1.5 text-gray-400 hover:text-rose-600 rounded-lg hover:bg-rose-50"
                    title={t.common.delete}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Supersede Modal */}
      {supersedeModalSource && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl shadow-xl border border-gray-200 max-w-lg w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
              <ArrowRightLeft className="w-5 h-5 text-indigo-600" />
              Փոխարինել աղբյուրի տարբերակը
            </h3>
            <p className="text-xs text-gray-600">
              {t.registry.supersedePrompt}
            </p>
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 text-xs">
              <span className="font-semibold text-gray-900 block">{supersedeModalSource.title}</span>
              <span className="text-gray-700 font-mono">
                Ընթացիկ տարբերակ՝ v{supersedeModalSource.version}
              </span>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-gray-700 mb-1">
                  Նոր տարբերակի համար (Version) *
                </label>
                <input
                  type="text"
                  value={newVersionStr}
                  onChange={(e) => setNewVersionStr(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg p-2.5 text-xs text-gray-900 outline-hidden focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="block font-medium text-gray-700 mb-1">
                  Թարմացված տեքստ (եթե տեքստը փոխվել է, հակառակ դեպքում կպահպանվի նախորդը)
                </label>
                <textarea
                  rows={4}
                  value={supersedeContent}
                  onChange={(e) => setSupersedeContent(e.target.value)}
                  placeholder="Նոր տեքստային բովանդակություն..."
                  className="w-full border border-gray-300 rounded-lg p-2.5 text-xs text-gray-900 outline-hidden font-mono"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setSupersedeModalSource(null)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-xs font-medium text-gray-700 hover:bg-gray-50"
              >
                {t.common.cancel}
              </button>
              <button
                type="button"
                onClick={handleSupersede}
                disabled={loading || !newVersionStr}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700"
              >
                Հաստատել փոխարինումը
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
