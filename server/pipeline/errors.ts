/** A request that cannot be served as sent (missing / invalid input). Mapped to HTTP 400. */
export class UserInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserInputError';
  }
}

/**
 * A grade from an untrusted request body: a positive integer, or a string of
 * digits. The type is checked before conversion — Number(true) === 1 and
 * Number([7]) === 7 must not pass as grades. Anything else is a 400.
 */
export function parseGradeInput(grade: unknown): number {
  const n =
    typeof grade === 'number' ? grade : typeof grade === 'string' && /^\d+$/.test(grade.trim()) ? Number(grade.trim()) : NaN;
  if (!Number.isInteger(n) || n < 1) {
    throw new UserInputError(`«grade» դաշտը պարտադիր է և պետք է լինի դասարանի համար (ստացվել է՝ ${JSON.stringify(grade)}):`);
  }
  return n;
}

/**
 * The request was valid but conflicts with the current state: a stale
 * revision, a decision already made, or the same operation already running.
 * Mapped to HTTP 409. The client should reload and decide again.
 */
export class ConflictError extends UserInputError {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

/**
 * The upload contains content that could not be inspected for personal data
 * (images, embedded objects). It is kept only if the uploader states it holds
 * no student data. Mapped to HTTP 400 with the parts listed.
 */
export class DeclarationRequiredError extends UserInputError {
  constructor(readonly parts: string[]) {
    super(
      `Ֆայլում կան մասեր, որոնց բովանդակությունը հնարավոր չէ ստուգել անձնական տվյալների համար (${parts.join(', ')}): Շարունակելու համար հաստատեք, որ դրանցում աշակերտների անձնական տվյալներ չկան:`
    );
    this.name = 'DeclarationRequiredError';
  }
}
