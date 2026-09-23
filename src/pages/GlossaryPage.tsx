import React, { useState, useEffect } from 'react';
import {
  BookMarked,
  Plus,
  Search,
  CheckCircle,
  AlertTriangle,
  BookOpen,
} from 'lucide-react';
import { Language, PinnedContext, Role, TerminologyGlossaryItem } from '../../shared/types';
import { translations } from '../i18n/translations';

interface GlossaryPageProps {
  lang: Language;
  role: Role;
  pinnedContext: PinnedContext;
}

export const GlossaryPage: React.FC<GlossaryPageProps> = ({
  lang,
  role,
  pinnedContext,
}) => {
  const t = translations[lang];
  const [glossary, setGlossary] = useState<TerminologyGlossaryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newTerm, setNewTerm] = useState({
    termArmenian: '',
    termEnglish: '',
    termRussian: '',
    definition: '',
    subject: pinnedContext.subject,
    grade: pinnedContext.grade,
    preferredStandardVariant: '',
    forbiddenVariants: '',
  });

  useEffect(() => {
    fetchGlossary();
  }, [pinnedContext.subject, pinnedContext.grade]);

  const fetchGlossary = async () => {
    try {
      const res = await fetch(`/api/glossary?subject=${encodeURIComponent(pinnedContext.subject)}&grade=${pinnedContext.grade}`);
      const data = await res.json();
      if (data.glossary) {
        setGlossary(data.glossary);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleAddTerm = async () => {
    if (!newTerm.termArmenian || !newTerm.definition) return;
    try {
      const res = await fetch('/api/glossary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...newTerm,
          grade: Number(newTerm.grade),
          forbiddenVariants: newTerm.forbiddenVariants.split(',').map((s) => s.trim()).filter(Boolean),
        }),
      });
      const data = await res.json();
      if (data.item) {
        setGlossary((prev) => [data.item, ...prev]);
        setShowAddModal(false);
        setNewTerm({
          termArmenian: '',
          termEnglish: '',
          termRussian: '',
          definition: '',
          subject: pinnedContext.subject,
          grade: pinnedContext.grade,
          preferredStandardVariant: '',
          forbiddenVariants: '',
        });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const filtered = glossary.filter(
    (g) =>
      (g.termArmenian || g.preferredTerm || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      g.definition.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-gray-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-indigo-50 text-indigo-700 rounded-xl">
              <BookMarked className="w-5 h-5" />
            </span>
            <h1 className="text-xl font-bold text-gray-900">{t.nav.glossary}</h1>
          </div>
          <p className="text-xs text-gray-700 mt-1">
            ՀՀ ԿԳՄՍՆ պետական չափորոշիչներով նախատեսված պաշտոնական տերմինացանկ
          </p>
        </div>

        <div className="flex items-center gap-2">
          {(role === 'methodologist' || role === 'admin') && (
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors"
            >
              <Plus className="w-4 h-4" />
              Ավելացնել տերմին
            </button>
          )}
        </div>
      </div>

      {/* Search Input */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-xs">
        <div className="relative">
          <Search className="w-4 h-4 text-gray-700 absolute left-3 top-3" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Որոնել տերմին կամ սահմանում..."
            className="w-full pl-9 pr-4 py-2 text-xs bg-gray-50 border border-gray-300 rounded-lg focus:outline-hidden focus:bg-white"
          />
        </div>
      </div>

      {/* Glossary Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map((item) => (
          <div
            key={item.id}
            className="bg-white p-5 rounded-2xl border border-gray-200 shadow-xs space-y-3 text-xs"
          >
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-bold text-base text-gray-900">{item.termArmenian || item.preferredTerm}</h3>
                {(item.termEnglish || item.termRussian) && (
                  <span className="text-[11px] text-gray-700 font-medium">
                    {item.termEnglish || ''} {item.termEnglish && item.termRussian ? '/' : ''} {item.termRussian || ''}
                  </span>
                )}
              </div>
              <span className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 font-mono text-[10px] font-semibold">
                {item.subject}
              </span>
            </div>

            <p className="text-gray-700 leading-relaxed">{item.definition}</p>

            <div className="pt-2 border-t border-gray-100 space-y-1">
              <div className="flex items-center gap-1.5 text-emerald-800">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                <span className="font-semibold">Նախընտրելի ձև՝ {item.preferredStandardVariant || item.preferredTerm}</span>
              </div>
              {item.forbiddenVariants && item.forbiddenVariants.length > 0 && (
                <div className="flex items-center gap-1.5 text-amber-800">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>Արգելված ձևեր՝ {item.forbiddenVariants.join(', ')}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Add Term Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-xl text-xs">
            <div className="flex items-center justify-between border-b border-gray-200 pb-3">
              <h3 className="text-base font-bold text-gray-900">Ավելացնել նոր պաշտոնական տերմին</h3>
              <button onClick={() => setShowAddModal(false)} className="text-gray-700 text-sm font-bold">
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="font-semibold block mb-1">Տերմին (Հայերեն)</label>
                <input
                  type="text"
                  value={newTerm.termArmenian}
                  onChange={(e) => setNewTerm({ ...newTerm, termArmenian: e.target.value })}
                  className="w-full p-2 bg-gray-50 border rounded-lg"
                />
              </div>

              <div>
                <label className="font-semibold block mb-1">Սահմանում</label>
                <textarea
                  rows={3}
                  value={newTerm.definition}
                  onChange={(e) => setNewTerm({ ...newTerm, definition: e.target.value })}
                  className="w-full p-2 bg-gray-50 border rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-semibold block mb-1">Նախընտրելի ձև</label>
                  <input
                    type="text"
                    value={newTerm.preferredStandardVariant}
                    onChange={(e) => setNewTerm({ ...newTerm, preferredStandardVariant: e.target.value })}
                    className="w-full p-2 bg-gray-50 border rounded-lg"
                  />
                </div>
                <div>
                  <label className="font-semibold block mb-1">Արգելված տարբերակներ</label>
                  <input
                    type="text"
                    value={newTerm.forbiddenVariants}
                    onChange={(e) => setNewTerm({ ...newTerm, forbiddenVariants: e.target.value })}
                    placeholder="ստորակետով"
                    className="w-full p-2 bg-gray-50 border rounded-lg"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 border rounded-xl font-medium"
              >
                Չեղարկել
              </button>
              <button
                onClick={handleAddTerm}
                className="px-4 py-2 bg-indigo-600 text-white rounded-xl font-semibold"
              >
                Պահպանել
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
