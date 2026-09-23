import React, { useState, useEffect } from 'react';
import {
  BarChart3,
  TrendingUp,
  AlertCircle,
  Building2,
  Calendar,
  CheckCircle,
  ShieldCheck,
  BookOpen,
} from 'lucide-react';
import { Language, PinnedContext, Role } from '../../shared/types';
import { translations } from '../i18n/translations';
import { Badge } from '../components/Badge';

interface DashboardsPageProps {
  lang: Language;
  role: Role;
  pinnedContext: PinnedContext;
}

export const DashboardsPage: React.FC<DashboardsPageProps> = ({
  lang,
  role,
  pinnedContext,
}) => {
  const t = translations[lang];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-gray-200 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-indigo-50 text-indigo-700 rounded-xl">
              <BarChart3 className="w-5 h-5" />
            </span>
            <h1 className="text-xl font-bold text-gray-900">{t.dashboards.title}</h1>
          </div>
          <p className="text-xs text-gray-700 mt-1">{t.dashboards.subtitle}</p>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <Badge variant="demo">DEMO DATA</Badge>
            <span className="text-[11px] text-indigo-900">{t.dashboards.demoNotice}</span>
          </div>
        </div>

        {/* Ethical Non-Surveillance Notice */}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900">
          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>Առանց ուսուցիչների վարկանիշավորման (No Surveillance)</span>
        </div>
      </div>

      {/* Aggregate Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
        <div className="p-5 bg-white rounded-2xl border border-gray-200 shadow-xs space-y-1">
          <span className="text-gray-700 block font-medium">Ծրագրի միջին կատարողական</span>
          <span className="text-2xl font-bold text-indigo-700">97.4%</span>
          <span className="text-[11px] text-emerald-600 block font-semibold">+2.1% նախորդ տարվա համեմատ</span>
        </div>

        <div className="p-5 bg-white rounded-2xl border border-gray-200 shadow-xs space-y-1">
          <span className="text-gray-700 block font-medium">Ժամանակացույցով ընթացող դպրոցներ</span>
          <span className="text-2xl font-bold text-emerald-700">3 / 3 (100%)</span>
          <span className="text-[11px] text-gray-700 block">Շեղումը չի գերազանցում 2 ժամը</span>
        </div>

        <div className="p-5 bg-white rounded-2xl border border-gray-200 shadow-xs space-y-1">
          <span className="text-gray-700 block font-medium">Համակարգային դժվար վերջնարդյունքներ</span>
          <span className="text-2xl font-bold text-amber-700">2 կոդ</span>
          <span className="text-[11px] text-amber-700 block font-semibold">Յուրացման մակարդակը &lt; 60%</span>
        </div>

        <div className="p-5 bg-white rounded-2xl border border-gray-200 shadow-xs space-y-1">
          <span className="text-gray-700 block font-medium">Հաստատված հաշվետվություններ</span>
          <span className="text-2xl font-bold text-purple-700">4 / 4</span>
          <span className="text-[11px] text-purple-700 block">1-ին կիսամյակ (2026-2027)</span>
        </div>
      </div>

      {/* Grid: Program Progress by School & Problematic Outcomes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Progress Curves by School */}
        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-xs space-y-4 text-xs">
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider flex items-center gap-2">
            <Building2 className="w-4 h-4 text-indigo-600" />
            Ծրագրի կատարման առաջընթաց ըստ դպրոցների
          </h2>

          <div className="space-y-4 pt-2">
            <div>
              <div className="flex justify-between font-semibold text-gray-800 mb-1">
                <span>Դպրոց Ա (ցուցադրական, Երևան)</span>
                <span className="text-indigo-700">32 / 32 ժամ (100%)</span>
              </div>
              <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-600 rounded-full" style={{ width: '100%' }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between font-semibold text-gray-800 mb-1">
                <span>Դպրոց Բ (ցուցադրական, Գյումրի)</span>
                <span className="text-indigo-700">30 / 32 ժամ (93.7%)</span>
              </div>
              <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-600 rounded-full" style={{ width: '94%' }} />
              </div>
            </div>

            <div>
              <div className="flex justify-between font-semibold text-gray-800 mb-1">
                <span>Դպրոց Գ (ցուցադրական, Վանաձոր)</span>
                <span className="text-indigo-700">32 / 32 ժամ (100%)</span>
              </div>
              <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-600 rounded-full" style={{ width: '100%' }} />
              </div>
            </div>
          </div>
        </div>

        {/* Difficult Learning Outcomes */}
        <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-xs space-y-4 text-xs">
          <h2 className="text-sm font-bold text-gray-900 uppercase tracking-wider flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600" />
            Համակարգային դժվար յուրացվող վերջնարդյունքներ
          </h2>
          <p className="text-gray-700">
            Այս տվյալները հիմնված են թեստերի անանուն ավտոստուգման (Item Analysis) արդյունքների վրա:
          </p>

          <div className="space-y-3 pt-1">
            <div className="p-3.5 bg-amber-50/60 border border-amber-200 rounded-xl space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-amber-900">DEMO-ՀՊ-7-Ա-02</span>
                <span className="px-2 py-0.5 rounded bg-amber-200/80 font-bold text-[10px] text-amber-900">
                  Յուրացում՝ 52%
                </span>
              </div>
              <p className="text-gray-800">
                «Վերլուծել Տիգրանակերտի ռազմավարական նշանակությունը և Լուկուլլոսի դեմ մարտավարությունը»
              </p>
              <span className="text-[11px] text-indigo-700 block font-medium">
                Առաջարկ՝ Տրամադրել լրացուցիչ տեսողական քարտեզներ և աշխատանքային թերթիկներ:
              </span>
            </div>

            <div className="p-3.5 bg-amber-50/60 border border-amber-200 rounded-xl space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-mono font-bold text-amber-900">DEMO-ԲՆ-5-Լ-02</span>
                <span className="px-2 py-0.5 rounded bg-amber-200/80 font-bold text-[10px] text-amber-900">
                  Յուրացում՝ 58%
                </span>
              </div>
              <p className="text-gray-800">
                «Բացատրել քլորոպլաստների դերը լուսային էներգիայի կլանման գործընթացում»
              </p>
              <span className="text-[11px] text-indigo-700 block font-medium">
                Առաջարկ՝ Ավելացնել պարզ լաբորատոր փորձարարական առաջադրանքներ:
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
