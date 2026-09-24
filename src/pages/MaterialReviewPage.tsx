import React from 'react';
import type { Language, PinnedContext } from '../../shared/types';
import { MaterialsList } from './materials/MaterialsList';
import { Workbench } from './materials/Workbench';

interface Props {
  lang: Language;
  pinnedContext: PinnedContext;
  /** The open material (from the URL), or null for the list. */
  materialId: string | null;
  onOpenMaterial: (id: string | null) => void;
}

export function MaterialReviewPage({ lang, pinnedContext, materialId, onOpenMaterial }: Props) {
  if (materialId) return <Workbench key={materialId} lang={lang} materialId={materialId} onBack={() => onOpenMaterial(null)} />;
  return <MaterialsList lang={lang} pinnedContext={pinnedContext} onOpen={(id) => onOpenMaterial(id)} />;
}
