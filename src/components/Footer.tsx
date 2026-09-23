import React from 'react';
import { Language } from '../../shared/types';
import { translations } from '../i18n/translations';

interface FooterProps {
  lang: Language;
}

export const Footer: React.FC<FooterProps> = ({ lang }) => {
  const t = translations[lang];

  return (
    <footer className="bg-white border-t border-gray-200 mt-auto py-6">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-2">
        <p className="text-xs font-medium text-gray-500">
          {t.footerNotice}
        </p>
        <p className="text-[11px] text-gray-400">
          TeachFlow Curriculum Connector MVP &bull; Model Context Protocol &bull; Independent Verification Pipeline
        </p>
      </div>
    </footer>
  );
};
