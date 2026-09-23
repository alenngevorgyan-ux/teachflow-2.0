import React, { useState } from 'react';
import { Shield, Trash2, Download, CheckCircle2, Terminal, Info } from 'lucide-react';
import { Language } from '../../shared/types';
import { translations } from '../i18n/translations';

interface AboutDataPageProps {
  lang: Language;
}

export const AboutDataPage: React.FC<AboutDataPageProps> = ({ lang }) => {
  const t = translations[lang];

  const [wiping, setWiping] = useState(false);
  const [wipedNotice, setWipedNotice] = useState(false);

  const handleWipeData = async () => {
    if (!confirm('Հաստատու՞մ եք բոլոր ոչ դեմո տվյալների (ավելացված աղբյուրներ, գեներացված թեստեր) մաքրումը:')) return;
    setWiping(true);
    try {
      await fetch('/api/system/clear-non-demo', { method: 'POST' });
      setWipedNotice(true);
      setTimeout(() => setWipedNotice(false), 4000);
    } catch (err) {
      console.error('Failed to wipe data:', err);
    } finally {
      setWiping(false);
    }
  };

  const handleExportAll = async () => {
    try {
      const res = await fetch('/api/system/export');
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `teachflow-full-export-${Date.now()}.json`;
      a.click();
    } catch (err) {
      console.error('Failed to export data:', err);
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      {/* Header */}
      <div className="border-b border-gray-200 pb-5">
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2.5">
          <Shield className="w-6 h-6 text-indigo-600" />
          {t.aboutData.title}
        </h1>
        <p className="text-sm text-gray-700 mt-1">{t.aboutData.subtitle}</p>
      </div>

      {/* Privacy Notice Card */}
      <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-6 space-y-2">
        <div className="flex items-center gap-2 text-emerald-950 font-bold text-base">
          <CheckCircle2 className="w-5 h-5 text-emerald-700" />
          <span>Անձնական տվյալների պաշտպանություն</span>
        </div>
        <p className="text-xs text-emerald-900 leading-relaxed font-medium">
          {t.aboutData.noPersonalData} Համակարգում չեն գրանցվում աշակերտների կամ ծնողների տվյալներ, առաջադիմության կամ վարկանիշային աղյուսակներ, կամ ուսուցիչների վարքագծային վերահսկողություն:
        </p>
      </div>

      {/* Stored Objects & Model Providers transparency */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-xs space-y-4 text-xs text-gray-700">
        <h3 className="text-sm font-bold text-gray-900">
          Ի՞նչ տվյալներ են պահպանվում և ինչպե՞ս
        </h3>
        <ul className="list-disc list-inside space-y-1.5 leading-relaxed text-gray-800">
          <li>
            <strong>Աղբյուրներ (Sources)՝</strong> դասագրքերի և չափորոշիչների տեքստային հատվածներ (chunks) իրենց SHA256 հեշով, տարբերակով և հաստատող մարմնով:
          </li>
          <li>
            <strong>Մեթոդական կանոններ (Method Rules)՝</strong> սահմանված պահանջներ և ստուգաչափեր:
          </li>
          <li>
            <strong>Գեներացված թեստեր և Աուդիտորական հետագծեր (Audit Traces)՝</strong> ամեն մի հարցի համար գրանցվում է աղբյուրի ճշգրիտ մեջբերումը, օգտագործված մոդելը, և բոլոր անկախ ստուգումների արդյունքները:
          </li>
          <li>
            <strong>AI մոդելներին ուղարկվող տվյալներ՝</strong> բացառապես ընտրված ուսումնական աղբյուրների հատվածները և առաջադրանքների հրահանգները: Յուրաքանչյուր հարցման մոդել ID-ն և ժամանակը ֆիքսվում են:
          </li>
        </ul>
      </div>

      {/* Model Context Protocol (MCP) Server Guidance */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-xs space-y-4 text-xs text-gray-700">
        <div className="flex items-center gap-2 text-indigo-950 font-bold text-sm">
          <Terminal className="w-5 h-5 text-indigo-600" />
          <span>Model Context Protocol (MCP) ինտեգրում</span>
        </div>
        <p className="leading-relaxed text-gray-800">
          TeachFlow-ը հանդիսանում է նաև MCP սերվեր (Streamable HTTP at <code className="bg-gray-100 px-1.5 py-0.5 rounded font-mono text-indigo-700">/mcp</code>): Կազմակերպության կամ դպրոցի ադմինիստրատորը կարող է միացնել այն ChatGPT Edu կամ ցանկացած այլ MCP-համատեղելի միջավայրին:
        </p>

        <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 font-mono text-[11px] space-y-1">
          <div className="text-gray-700 font-semibold">Հասանելի գործիքներ (MCP Tools)՝</div>
          <p>&bull; <code>search_curriculum(subject, grade, query)</code></p>
          <p>&bull; <code>get_source_fragment(subject, grade, query)</code></p>
          <p>&bull; <code>generate_assessment_with_trace(subject, grade, topic, sourceIds)</code></p>
          <p>&bull; <code>validate_material(subject, grade, text, sourceIds)</code></p>
        </div>
      </div>

      {/* Data Management Actions */}
      <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-xs space-y-4">
        <h3 className="text-sm font-bold text-gray-900">
          Տվյալների կառավարում և արտահանում
        </h3>

        {wipedNotice && (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800">
            Բոլոր ոչ դեմո տվյալները հաջողությամբ մաքրվել են:
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <button
            onClick={handleExportAll}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 transition-colors shadow-xs flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            {t.aboutData.exportAllBtn}
          </button>

          <button
            disabled={wiping}
            onClick={handleWipeData}
            className="px-4 py-2 bg-white border border-rose-300 text-rose-700 rounded-lg text-xs font-semibold hover:bg-rose-50 transition-colors flex items-center gap-2"
          >
            <Trash2 className="w-4 h-4" />
            {t.aboutData.wipeBtn}
          </button>
        </div>
      </div>
    </div>
  );
};
