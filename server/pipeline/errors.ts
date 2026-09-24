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
