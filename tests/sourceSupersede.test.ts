import { describe, expect, it, vi } from 'vitest';
import type { Source } from '../shared/types.js';

vi.mock('../server/store/repository.js', () => ({ repository: { logAIInteraction: () => undefined } }));

import { UserInputError } from '../server/pipeline/errors.js';
import { buildSupersedingSource } from '../server/pipeline/sourceIngestion.js';
import { confirmSource, sourceConfirmationState, sourceContentHash } from '../server/pipeline/sourceConfirmation.js';

function old(o: Partial<Source> = {}): Source {
  const s: Source = {
    id: 'src-old',
    title: 'Ծրագիր',
    authority: 'test',
    docType: 'subject_program',
    subject: 'Հայոց պատմություն',
    grades: [7],
    role: 'FACT',
    version: '2024',
    effectiveFrom: '2024-09-01',
    status: 'active',
    sha256: 'file-hash',
    isDemo: false,
    uploadedAt: '2024-09-01T00:00:00Z',
    chunks: [{ id: 'src-old#p3#c1', sourceId: 'src-old', page: 3, text: 'Հին տեքստ' }],
    ...o,
  };
  return confirmSource(s, { confirmedByName: 'M', expectedVersion: s.version, expectedContentHash: sourceContentHash(s) });
}

describe('superseding a source', () => {
  it('refuses without a stated version or effective date — nothing is derived or defaulted', async () => {
    await expect(buildSupersedingSource(old(), {})).rejects.toThrow(UserInputError);
    await expect(buildSupersedingSource(old(), { newVersion: '2026' })).rejects.toThrow(/effectiveFrom/);
    await expect(buildSupersedingSource(old(), { effectiveFrom: '2026-09-01' })).rejects.toThrow(/newVersion/);
    await expect(buildSupersedingSource(old(), { newVersion: '2024', effectiveFrom: '2026-09-01' })).rejects.toThrow(/differ/);
    await expect(buildSupersedingSource(old(), { newVersion: '2026', effectiveFrom: '2026-13-40' })).rejects.toThrow(/effectiveFrom/);
  });

  it('uses the new text, keeps system facts apart from official particulars, drops the confirmation', async () => {
    const before = Date.now();
    const { source } = await buildSupersedingSource(old(), { newVersion: ' 2026 ', effectiveFrom: '2026-09-01', text: 'Նոր տեքստ\n\nԵրկրորդ պարբերություն' });
    expect(source.id).not.toBe('src-old'); // internal revision id
    expect(Date.parse(source.uploadedAt)).toBeGreaterThanOrEqual(before); // upload time (system)
    expect([source.version, source.effectiveFrom]).toEqual(['2026', '2026-09-01']); // stated particulars
    expect(source.chunks.map((c) => c.text).join('\n\n')).toBe('Նոր տեքստ\n\nԵրկրորդ պարբերություն');
    expect(source.chunks.every((c) => c.page === undefined && c.sourceId === source.id)).toBe(true);
    expect(source.sha256).not.toBe('file-hash');
    expect(source.confirmation).toBeUndefined();
    expect(sourceConfirmationState(source).state).toBe('unconfirmed');
    expect(source.effectiveTo).toBeUndefined();
  });

  it('without new text carries the old chunks, pages and file hash over', async () => {
    const { source } = await buildSupersedingSource(old(), { newVersion: '2026', effectiveFrom: '2026-09-01' });
    expect(source.chunks).toEqual([{ id: `${source.id}#p3#c1`, sourceId: source.id, page: 3, text: 'Հին տեքստ' }]);
    expect(source.sha256).toBe('file-hash');
  });

  it('a demo source stays demo (it cannot become confirmable by being superseded)', async () => {
    const demo: Source = { ...old(), isDemo: true, confirmation: undefined };
    const { source } = await buildSupersedingSource(demo, { newVersion: '2026', effectiveFrom: '2026-09-01' });
    expect(source.isDemo).toBe(true);
    expect(sourceConfirmationState(source).state).toBe('not_confirmable');
  });

  it('refuses personal data in the new text', async () => {
    await expect(buildSupersedingSource(old(), { newVersion: '2026', effectiveFrom: '2026-09-01', text: 'Արամ Պետրոսյան 7Բ-14' })).rejects.toThrow();
  });
});
