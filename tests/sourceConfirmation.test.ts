import { describe, expect, it } from 'vitest';
import type { Source } from '../shared/types.js';
import { UserInputError } from '../server/pipeline/errors.js';
import {
  confirmSource,
  revokeSourceConfirmation,
  sourceConfirmationState,
  sourceContentHash,
} from '../server/pipeline/sourceConfirmation.js';

function source(overrides: Partial<Source> = {}): Source {
  return {
    id: 'src-1',
    title: 'Subject program (test)',
    authority: 'test authority',
    docType: 'subject_program',
    subject: 'Հայոց պատմություն',
    grades: [7],
    role: 'FACT',
    version: 'v1',
    effectiveFrom: '2026-09-01',
    status: 'active',
    sha256: 'abc',
    isDemo: false,
    uploadedAt: '2026-09-01T00:00:00Z',
    chunks: [{ id: 'src-1#p1#c1', sourceId: 'src-1', page: 1, text: 'Տեքստ' }],
    ...overrides,
  };
}

const confirm = (s: Source) =>
  confirmSource(s, { confirmedByName: ' Մեթոդիստ ', expectedVersion: s.version, expectedContentHash: sourceContentHash(s) });

describe('source confirmation', () => {
  it('a source stored before confirmation existed is unconfirmed', () => {
    expect(sourceConfirmationState(source()).state).toBe('unconfirmed');
  });

  it('confirms the exact version and content, recording the stated name', () => {
    const s = confirm(source());
    expect(sourceConfirmationState(s).state).toBe('confirmed');
    expect(s.confirmation).toMatchObject({ confirmedByName: 'Մեթոդիստ', version: 'v1', contentHash: sourceContentHash(source()) });
  });

  it.each([
    ['chunk text', (s: Source) => ({ ...s, chunks: [{ ...s.chunks[0], text: 'Այլ տեքստ' }] })],
    ['grades', (s: Source) => ({ ...s, grades: [7, 8] })],
    ['subject', (s: Source) => ({ ...s, subject: 'Բնագիտություն' })],
    ['role', (s: Source) => ({ ...s, role: 'METHOD' as const })],
    ['file hash', (s: Source) => ({ ...s, sha256: 'def' })],
    ['effectiveFrom', (s: Source) => ({ ...s, effectiveFrom: '2027-09-01' })],
  ])('a change of %s invalidates the confirmation', (_label, change) => {
    expect(sourceConfirmationState(change(confirm(source()))).state).toBe('invalidated');
  });

  it('a new version invalidates the confirmation', () => {
    expect(sourceConfirmationState({ ...confirm(source()), version: 'v2' }).state).toBe('invalidated');
  });

  it('embeddings being added later do not invalidate it', () => {
    const s = confirm(source());
    const withEmb = { ...s, chunks: s.chunks.map((c) => ({ ...c, embedding: [0.1, 0.2] })) };
    expect(sourceConfirmationState(withEmb).state).toBe('confirmed');
  });

  it('demo and superseded sources cannot be confirmed', () => {
    expect(() => confirm(source({ isDemo: true }))).toThrow(UserInputError);
    expect(() => confirm(source({ status: 'superseded' }))).toThrow(UserInputError);
    // Even a stored confirmation does not count on demo data.
    expect(sourceConfirmationState({ ...confirm(source()), isDemo: true }).state).toBe('not_confirmable');
  });

  it('refuses when the source changed after the person looked at it', () => {
    const s = source();
    const seenHash = sourceContentHash(s);
    const changed = { ...s, chunks: [{ ...s.chunks[0], text: 'Փոխված' }] };
    expect(() => confirmSource(changed, { confirmedByName: 'A', expectedVersion: 'v1', expectedContentHash: seenHash })).toThrow(
      UserInputError
    );
  });

  it('requires a name', () => {
    const s = source();
    expect(() => confirmSource(s, { confirmedByName: '  ', expectedVersion: 'v1', expectedContentHash: sourceContentHash(s) })).toThrow(
      /confirmedByName/
    );
  });

  it('can be revoked', () => {
    expect(sourceConfirmationState(revokeSourceConfirmation(confirm(source()))).state).toBe('unconfirmed');
  });
});
