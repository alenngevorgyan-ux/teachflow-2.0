import crypto from 'crypto';
import { Source, SourceConfirmationState } from '../../shared/types.js';
import { UserInputError } from './errors.js';

// A confirmation is bound to one version and one content hash. The hash
// covers the text and every metadata field that changes what the source
// says or where it applies; changing any of them invalidates the
// confirmation and the source must be confirmed again. Embeddings, OCR flags,
// status and effectiveTo are not part of it: the first two are derived, and
// status is checked separately (only active sources are eligible).

export function sourceContentHash(s: Source): string {
  const significant = {
    title: s.title,
    authority: s.authority,
    docType: s.docType,
    subject: s.subject,
    grades: [...s.grades].sort((a, b) => a - b),
    role: s.role,
    version: s.version,
    effectiveFrom: s.effectiveFrom,
    fileSha256: s.sha256,
    chunks: s.chunks.map((c) => [c.id, c.page ?? null, c.text]),
  };
  return crypto.createHash('sha256').update(JSON.stringify(significant)).digest('hex');
}

export function sourceConfirmationState(s: Source): { state: SourceConfirmationState; reason?: string } {
  if (s.isDemo) return { state: 'not_confirmable', reason: 'Ցուցադրական տվյալները չեն կարող հաստատվել որպես իրական աղբյուր:' };
  if (s.status !== 'active') return { state: 'not_confirmable', reason: `Աղբյուրի կարգավիճակը՝ ${s.status}:` };
  const c = s.confirmation;
  if (!c) return { state: 'unconfirmed' };
  if (c.version !== s.version) {
    return { state: 'invalidated', reason: `Հաստատվել է ${c.version} տարբերակը, ընթացիկը՝ ${s.version}:` };
  }
  if (c.contentHash !== sourceContentHash(s)) {
    return { state: 'invalidated', reason: 'Տեքստը կամ մետատվյալները փոխվել են հաստատումից հետո:' };
  }
  return { state: 'confirmed' };
}

export function isSourceConfirmed(s: Source): boolean {
  return sourceConfirmationState(s).state === 'confirmed';
}

/**
 * Confirms exactly the version and content the person looked at: the client
 * sends back the version and hash it displayed, so a source that changed in
 * between is not confirmed blind.
 */
export function confirmSource(
  s: Source,
  input: { confirmedByName?: unknown; expectedVersion?: unknown; expectedContentHash?: unknown },
  now = new Date()
): Source {
  const name = typeof input.confirmedByName === 'string' ? input.confirmedByName.trim() : '';
  if (!name) throw new UserInputError('«confirmedByName» դաշտը պարտադիր է:');
  const st = sourceConfirmationState(s);
  if (st.state === 'not_confirmable') throw new UserInputError(`Աղբյուրը չի կարող հաստատվել. ${st.reason}`);
  const hash = sourceContentHash(s);
  if (input.expectedVersion !== s.version || input.expectedContentHash !== hash) {
    throw new UserInputError('Աղբյուրը փոխվել է այն դիտելուց հետո: Թարմացրեք էջը և ստուգեք նորից:');
  }
  return {
    ...s,
    confirmation: { confirmedByName: name, confirmedAt: now.toISOString(), version: s.version, contentHash: hash },
  };
}

export function revokeSourceConfirmation(s: Source): Source {
  const { confirmation: _c, ...rest } = s;
  return rest;
}
