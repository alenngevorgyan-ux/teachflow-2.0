// Privacy guard (rule 5: no student personal data).
//
// Two contexts:
// - 'content' (materials, report fields, legacy import, chat): e-mails and
//   phone numbers are always flagged. A "first name + surname" pair is flagged
//   ONLY when it sits near a student marker — an anonymous student code
//   (7B-14), a class label (7Բ, «դասարան», «класс»), the word student, or a
//   phone / e-mail. Historical and literary names in teaching content
//   («Տիգրան Մեծ», «Խաչատուր Աբովյան») are therefore not blocked.
// - 'student_code': the value must be an anonymous code, so any name-shaped
//   word is flagged regardless of surroundings.

export type PrivacyContext = 'content' | 'student_code';

export interface PrivacyFinding {
  kind: 'email' | 'phone' | 'full_name' | 'name_in_student_code';
  match: string;
}

export interface PrivacyCheckResult {
  hasPii: boolean;
  warnings: string[];
  blocked: boolean;
  findings: PrivacyFinding[];
}

// Common Armenian first names (Armenian script). Used to strengthen matches;
// in 'content' mode a capitalised word next to a surname-shaped word is
// enough, because the pair must also be near a student marker.
const ARMENIAN_FIRST_NAMES = new Set([
  'Արմեն', 'Արամ', 'Արթուր', 'Աշոտ', 'Գարիկ', 'Գևորգ', 'Դավիթ', 'Էդգար', 'Հայկ', 'Կարեն',
  'Նարեկ', 'Տիգրան', 'Սարգիս', 'Սամվել', 'Վահան', 'Վահե', 'Անահիտ', 'Անի', 'Գայանե', 'Լիլիթ',
  'Մարիամ', 'Մարինե', 'Նաիրա', 'Սոնա', 'Տաթև', 'Հասմիկ', 'Լուսինե', 'Ռուզան', 'Շուշան',
  'Արսեն', 'Էրիկ', 'Մհեր', 'Ռաֆայել', 'Հրանտ', 'Լևոն', 'Մանե', 'Էլեն', 'Սյուզաննա', 'Արփի',
]);

// Surname endings, optionally followed by an Armenian case ending
// (Պետրոսյանը, Պետրոսյանի, Պետրոսյանին) or a Russian one (Петросяна).
const ARM_SURNAME = /^\p{Lu}\p{Ll}+(?:յան|եան|յանց|ունի|ունց)(?:ը|ի|ին|ից|ով|ն)?$/u;
const LAT_SURNAME = /^\p{Lu}\p{Ll}+(?:yan|ian|yants)$/u;
const CYR_SURNAME = /^\p{Lu}\p{Ll}+(?:ян|янц)(?:а|у|ом|е)?$/u;
const CAPITALISED_WORD = /^\p{Lu}\p{Ll}+$/u;
// Armenian case endings stripped when matching the first-name list.
const ARM_CASE_ENDING = /(?:ը|ի|ին|ից|ով|ն)$/u;

// A name pair right after one of these words is a staff member (teacher,
// director), not a student — e.g. «Ուսուցիչ՝ Անահիտ Պետրոսյան, 7Բ դասարան».
const STAFF_ROLE_WORDS = /^(?:ուսուցիչ|ուսուցչուհի|ուսուցիչը|տնօրեն|տնօրենը|փոխտնօրեն|մեթոդմիավորման|учитель|учительница|директор|teacher|director|principal)[՝:,.]?$/iu;

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Candidate phone numbers; validated by digit count below so that dates,
// years (2026-2027) and page ranges are not flagged.
const PHONE_CANDIDATE = /(?<![\p{L}\p{N}])(?:\+|0)[\d\s()-]{7,18}\d(?![\p{L}\p{N}])/gu;

// Student markers used for the "near" rule.
const STUDENT_CODE = /(?<![\p{L}\p{N}])\d{1,2}\p{L}-\d{1,3}(?![\p{L}\p{N}])/gu;
const CLASS_LABEL = /(?<![\p{L}\p{N}])\d{1,2}\s?-?\s?\p{Lu}(?![\p{L}\p{N}])/gu;
const STUDENT_WORDS = /(?:դասարան|աշակերտ|սովորող|класс|ученик|ученица|student|pupil|class\s+\d)/giu;

const NEAR_WINDOW = 120;

function isValidPhone(candidate: string): boolean {
  const digits = candidate.replace(/\D/g, '');
  if (candidate.trim().startsWith('+')) return digits.length >= 10 && digits.length <= 15;
  // Armenian national format: 0 + 8 digits (e.g. 055 12 34 56, 010 54 32 10).
  if (digits.startsWith('00374')) return digits.length === 13;
  return digits.startsWith('0') && digits.length === 9;
}

function findPhones(content: string): string[] {
  return (content.match(PHONE_CANDIDATE) || []).map((p) => p.trim()).filter(isValidPhone);
}

function isSurnameShaped(word: string): boolean {
  return ARM_SURNAME.test(word) || LAT_SURNAME.test(word) || CYR_SURNAME.test(word);
}

function isKnownFirstName(word: string): boolean {
  return ARMENIAN_FIRST_NAMES.has(word) || ARMENIAN_FIRST_NAMES.has(word.replace(ARM_CASE_ENDING, ''));
}

interface Token {
  word: string;
  start: number;
  end: number;
}

function tokenize(content: string): Token[] {
  const tokens: Token[] = [];
  const re = /[\p{L}\p{M}]+(?:[-'][\p{L}\p{M}]+)*[՝:,.]?/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    tokens.push({ word: m[0], start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

function stripPunct(word: string): string {
  return word.replace(/[՝:,.]$/u, '');
}

function markerSpans(content: string, extra: string[]): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const re of [STUDENT_CODE, CLASS_LABEL, STUDENT_WORDS, EMAIL_REGEX]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) spans.push([m.index, m.index + m[0].length]);
  }
  for (const p of extra) {
    let idx = content.indexOf(p);
    while (idx >= 0) {
      spans.push([idx, idx + p.length]);
      idx = content.indexOf(p, idx + 1);
    }
  }
  return spans;
}

function isNearMarker(start: number, end: number, spans: Array<[number, number]>): boolean {
  return spans.some(([s, e]) => s <= end + NEAR_WINDOW && e >= start - NEAR_WINDOW);
}

function precededByStaffRole(tokens: Token[], i: number): boolean {
  for (let k = Math.max(0, i - 3); k < i; k++) {
    if (STAFF_ROLE_WORDS.test(tokens[k].word)) return true;
  }
  return false;
}

function findNamePairs(content: string, phones: string[]): string[] {
  const tokens = tokenize(content);
  const spans = markerSpans(content, phones);
  if (spans.length === 0) return [];

  const found: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    const a = tokens[i];
    const b = tokens[i + 1];
    // Only words separated by whitespace form a name (not "Արմեն, Պետրոսյան").
    if (!/^\s+$/.test(content.slice(a.end, b.start)) || /[՝:,.]$/u.test(a.word)) continue;
    const w1 = a.word;
    const w2 = stripPunct(b.word);
    if (!CAPITALISED_WORD.test(w1) || !CAPITALISED_WORD.test(w2)) continue;

    // First-name + surname, or surname + first-name (class-list order).
    const isPair =
      (isSurnameShaped(w2) && (isKnownFirstName(w1) || !isSurnameShaped(w1))) ||
      (isSurnameShaped(w1) && isKnownFirstName(w2));
    if (!isPair) continue;
    if (precededByStaffRole(tokens, i)) continue;
    if (!isNearMarker(a.start, b.end, spans)) continue;

    found.push(`${w1} ${w2}`);
    i++;
  }
  return found;
}

function findNamesInStudentCode(code: string): string[] {
  const words = tokenize(code).map((t) => stripPunct(t.word));
  const nameLike = words.filter((w) => isKnownFirstName(w) || isSurnameShaped(w));
  if (nameLike.length > 0) return nameLike;
  // Two or more alphabetic words (e.g. "Anna Smith") cannot be an anonymous code.
  const alphaWords = words.filter((w) => /^\p{L}{2,}$/u.test(w));
  return alphaWords.length >= 2 ? [alphaWords.join(' ')] : [];
}

export function checkPrivacy(content: string, options: { context?: PrivacyContext } = {}): PrivacyCheckResult {
  const context = options.context ?? 'content';
  const warnings: string[] = [];
  const findings: PrivacyFinding[] = [];
  const text = content || '';

  const emails = text.match(EMAIL_REGEX) || [];
  if (emails.length > 0) {
    findings.push(...emails.map((match) => ({ kind: 'email' as const, match })));
    warnings.push(`Հայտնաբերվել է էլ. փոստի հասցե (${emails.join(', ')}): Պահպանումն արգելափակված է:`);
  }

  const phones = findPhones(text);
  if (phones.length > 0) {
    findings.push(...phones.map((match) => ({ kind: 'phone' as const, match })));
    warnings.push(`Հայտնաբերվել է հեռախոսահամար (${phones.join(', ')}): Պահպանումն արգելափակված է:`);
  }

  if (context === 'student_code') {
    const names = findNamesInStudentCode(text);
    if (names.length > 0) {
      findings.push(...names.map((match) => ({ kind: 'name_in_student_code' as const, match })));
      warnings.push(
        `Աշակերտի կոդը պարունակում է անուն («${names.join(', ')}»): Թույլատրվում են միայն անանուն կոդեր (օր.՝ 7B-14):`
      );
    }
  } else {
    const pairs = findNamePairs(text, phones);
    if (pairs.length > 0) {
      findings.push(...pairs.map((match) => ({ kind: 'full_name' as const, match })));
      warnings.push(
        `Հայտնաբերվել է աշակերտի ամբողջական անուն-ազգանուն («${pairs.join('», «')}») աշակերտի կոդի/դասարանի/կոնտակտի կողքին: Համակարգը թույլատրում է միայն անանուն կոդեր (օր.՝ 7B-14):`
      );
    }
  }

  const hasPii = findings.length > 0;
  return { hasPii, warnings, blocked: hasPii, findings };
}

export class PrivacyViolationError extends Error {
  readonly warnings: string[];
  readonly findings: PrivacyFinding[];
  readonly where: string;

  constructor(where: string, result: PrivacyCheckResult) {
    super(result.warnings[0] || 'Privacy check failed');
    this.name = 'PrivacyViolationError';
    this.where = where;
    this.warnings = result.warnings;
    this.findings = result.findings;
  }
}

/** Collect every string leaf of a value (report data, table rows, row updates). */
export function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === 'object') Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
}

/** Throws PrivacyViolationError if any string in `value` carries student PII. */
export function assertNoPii(value: unknown, where: string, options: { context?: PrivacyContext } = {}): void {
  const text = collectStrings(value).join('\n');
  const result = checkPrivacy(text, options);
  if (result.blocked) throw new PrivacyViolationError(where, result);
}

/** Student codes must be present and anonymous. */
export function assertStudentCode(code: unknown, where = 'studentCode'): string {
  if (typeof code !== 'string' || !code.trim()) {
    throw new PrivacyViolationError(where, {
      hasPii: false,
      blocked: true,
      findings: [],
      warnings: ['Աշակերտի կոդը պարտադիր է (օր.՝ 7B-14):'],
    });
  }
  assertNoPii(code, where, { context: 'student_code' });
  return code.trim();
}
