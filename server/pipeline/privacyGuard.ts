// Privacy guard (rule 5: no student personal data).
//
// Contexts:
// - 'content' (materials, reports, chat, templates, glossary, ...):
//   * e-mails, phone numbers and birth dates are always flagged;
//   * values under personal-data field names (studentName, dateOfBirth, ...)
//     are flagged;
//   * a first name + surname pair is flagged only when there is evidence it
//     is a student:
//       - strong marker (student code 7B-14, phone, e-mail, birth date)
//         within NEAR_WINDOW characters, or
//       - weak marker (class label 7Բ / «դասարան» / «класс», the word
//         student) directly next to the name in the same sentence, or
//       - the pair is a line of a class roster (≥ 2 lines that are just a
//         name, optionally numbered and/or followed by a score).
//     Historical names in teaching text («Տիգրան Մեծ», «Խաչատուր Աբովյան»)
//     therefore pass unless they sit right next to such a marker.
//   * a pair directly after a staff role word (ուսուցիչ, ուսուցչի, տնօրենը,
//     учитель, teacher, ...) is staff, not a student.
// - 'student_code': the value must be an anonymous code (see
//   isAnonymousStudentCode), nothing else.
//
// Options: allowContacts — official sources (standards, programs) may carry
// an institution's phone / e-mail; those are not flagged there and do not act
// as markers. Names near student markers are still flagged.

export type PrivacyContext = 'content' | 'student_code';

export interface PrivacyOptions {
  context?: PrivacyContext;
  allowContacts?: boolean;
}

export interface PrivacyFinding {
  kind:
    | 'email'
    | 'phone'
    | 'birth_date'
    | 'full_name'
    | 'personal_field'
    | 'invalid_student_code';
  match: string;
}

export interface PrivacyCheckResult {
  hasPii: boolean;
  warnings: string[];
  blocked: boolean;
  findings: PrivacyFinding[];
}

// ---------------------------------------------------------------- names

// Common first names. Matching is case-insensitive; Armenian case endings are
// stripped (Արմենը, Արմենի). Only used to accept pairs that are not
// capitalised (արամ պետրոսյան) and to strengthen surname-first order.
const FIRST_NAMES = new Set(
  [
    'Արմեն', 'Արամ', 'Արթուր', 'Աշոտ', 'Գարիկ', 'Գևորգ', 'Դավիթ', 'Էդգար', 'Հայկ', 'Կարեն',
    'Նարեկ', 'Տիգրան', 'Սարգիս', 'Սամվել', 'Վահան', 'Վահե', 'Անահիտ', 'Անի', 'Գայանե', 'Լիլիթ',
    'Մարիամ', 'Մարինե', 'Նաիրա', 'Սոնա', 'Տաթև', 'Հասմիկ', 'Լուսինե', 'Ռուզան', 'Շուշան',
    'Արսեն', 'Էրիկ', 'Մհեր', 'Ռաֆայել', 'Հրանտ', 'Լևոն', 'Մանե', 'Էլեն', 'Սյուզաննա', 'Արփի',
    'Aram', 'Armen', 'Arthur', 'Artur', 'David', 'Davit', 'Tigran', 'Narek', 'Karen', 'Hayk', 'Ani',
    'Anna', 'Mariam', 'Lilit', 'Nare', 'Mane', 'John', 'Mary',
    'Арам', 'Армен', 'Артур', 'Давид', 'Тигран', 'Нарек', 'Карен', 'Айк', 'Ани', 'Анна', 'Мариам',
    'Лилит', 'Иван', 'Мария', 'Анна',
  ].map((n) => n.toLowerCase())
);

const ARM_CASE_ENDING = /(?:ը|ի|ին|ից|ով|ն|ու)$/u;
const ARM_SURNAME = /(?:յան|եան|յանց|ունի|ունց)(?:ը|ի|ին|ից|ով|ն|ու)?$/u;
const LAT_SURNAME = /(?:yan|ian|yants|ov|ova|ev|eva|sky|skaya)$/u;
const CYR_SURNAME = /(?:ян|янц|ов|ова|ев|ева|ёв|ёва|ин|ина|ын|ына|ский|ская|цкий|цкая)(?:а|у|ом|е|ым|ой)?$/u;

const isArmenian = (w: string) => /\p{Script=Armenian}/u.test(w);
const isCapitalised = (w: string) => /^\p{Lu}\p{Ll}+$/u.test(w);
const isAllUpper = (w: string) => /^\p{Lu}{2,}$/u.test(w);
const isAllLower = (w: string) => /^\p{Ll}{2,}$/u.test(w);
const isCapOrUpper = (w: string) => isCapitalised(w) || isAllUpper(w);

function isSurnameShaped(word: string): boolean {
  const w = word.toLowerCase();
  if (isArmenian(w)) return w.length >= 5 && ARM_SURNAME.test(w);
  if (/\p{Script=Cyrillic}/u.test(w)) return w.length >= 5 && CYR_SURNAME.test(w);
  return w.length >= 5 && LAT_SURNAME.test(w);
}

function isKnownFirstName(word: string): boolean {
  const w = word.toLowerCase();
  return FIRST_NAMES.has(w) || FIRST_NAMES.has(w.replace(ARM_CASE_ENDING, ''));
}

/** Two adjacent words that look like a person's name, or null. */
function namePairKind(w1: string, w2: string): 'shaped' | 'generic' | null {
  const sameCase =
    (isCapitalised(w1) && isCapitalised(w2)) ||
    (isAllUpper(w1) && isAllUpper(w2)) ||
    (isAllLower(w1) && isAllLower(w2));
  if (!sameCase) return null;
  const lower = isAllLower(w1);
  // Lower-case pairs need a known first name: «արամ պետրոսյան».
  if (isSurnameShaped(w2) && (isKnownFirstName(w1) || (!lower && !isSurnameShaped(w1)))) return 'shaped';
  if (isSurnameShaped(w1) && (isKnownFirstName(w2) || (!lower && isCapOrUpper(w2)))) return 'shaped';
  // Non-Armenian names often have no recognisable surname ending
  // («John Smith»). Accepted only right next to a marker (see below).
  if (!lower && !isArmenian(w1) && !isArmenian(w2)) return 'generic';
  return null;
}

// A staff role word directly before a name: the person is staff, not a
// student. Stems cover inflected forms (ուսուցիչ, ուսուցչի, ուսուցչուհին).
const STAFF_ROLE = /^(?:ուսուց\p{L}*|տնօրեն\p{L}*|փոխտնօրեն\p{L}*|դասղեկ\p{L}*|մեթոդմիավորման|учител\p{L}*|директор\p{L}*|завуч\p{L}*|teacher|director|principal)$/iu;

// ---------------------------------------------------------------- markers

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Armenian national (0XX XXXXXX) and +374 / 00374 numbers, exact digit count
// with optional separators; the match stops at the number, so a following
// number cannot hide it.
const PHONE_AM = /(?<![\p{L}\p{N}+])(?:\+374|00374|0)[\s-]?\(?\d{2}\)?(?:[\s-]?\d){6}(?!\d)/gu;
// Other international numbers: + and at least 8 digits.
const PHONE_INTL = /(?<![\p{L}\p{N}])\+(?!374)\d(?:[\s()-]?\d){7,14}(?!\d)/gu;

const STUDENT_CODE = /(?<![\p{L}\p{N}])\d{1,2}\p{L}-\d{1,3}(?![\p{L}\p{N}])/gu;
const CLASS_LABEL = /(?<![\p{L}\p{N}])\d{1,2}\s?-?\s?\p{Lu}(?![\p{L}\p{N}])/gu;
const WEAK_WORDS = /(?<![\p{L}])(?:դասարան\p{L}*|աշակերտ\p{L}*|սովորող\p{L}*|класс\p{L}*|ученик\p{L}*|ученица\p{L}*|student\p{L}*|pupil\p{L}*|class)(?![\p{L}])/giu;

const BIRTH_WORD = /(?:ծննդ\p{L}*|ծնվ\p{L}*|birth\p{L}*|dob|рожд\p{L}*|родил\p{L}*)/giu;
const DATE = /(?<![\p{N}])(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}[./-]\d{1,2}[./-]\d{1,2})(?![\p{N}])/gu;

// Field names that hold personal data whatever their value looks like.
const PERSONAL_FIELD = /^(?:student_?name|first_?name|last_?name|sur_?name|full_?name|middle_?name|parent_?name|father_?name|mother_?name|birth_?date|date_?of_?birth|dob|birthday|phone(?:_?number)?|mobile|e_?mail|home_?address|address|фио|имя|фамилия|отчество|անուն|ազգանուն|հայրանուն)$/iu;

const NEAR_WINDOW = 120;
const WEAK_GAP = 0;

interface Span {
  start: number;
  end: number;
}

function spansOf(re: RegExp, text: string): Span[] {
  const out: Span[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push({ start: m.index, end: m.index + m[0].length });
  return out;
}

function matchesOf(re: RegExp, text: string): string[] {
  re.lastIndex = 0;
  return (text.match(re) || []).map((s) => s.trim());
}

function findPhones(text: string): string[] {
  return [...matchesOf(PHONE_AM, text), ...matchesOf(PHONE_INTL, text)];
}

function findBirthDates(text: string): string[] {
  const words = spansOf(BIRTH_WORD, text);
  if (words.length === 0) return [];
  return spansOf(DATE, text)
    .filter((d) => words.some((w) => Math.abs(d.start - w.end) <= 40 || Math.abs(w.start - d.end) <= 40))
    .map((d) => text.slice(d.start, d.end));
}

// ---------------------------------------------------------------- tokens

interface Token {
  word: string;
  start: number;
  end: number;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const re = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) tokens.push({ word: m[0], start: m.index, end: m.index + m[0].length });
  return tokens;
}

const SENTENCE_END = /[.։!?\n]/u;

/** Number of words between a span and a token range, if in the same sentence. */
function wordGap(text: string, tokens: Token[], span: Span, from: number, to: number): number | null {
  const a = tokens[from];
  const b = tokens[to];
  let between: string;
  let lo: number;
  let hi: number;
  if (span.end <= a.start) {
    between = text.slice(span.end, a.start);
    lo = span.end;
    hi = a.start;
  } else if (span.start >= b.end) {
    between = text.slice(b.end, span.start);
    lo = b.end;
    hi = span.start;
  } else {
    return 0; // overlapping
  }
  // A sentence end (. ։ ! ? or a line break) between them breaks the link.
  if (SENTENCE_END.test(between)) return null;
  return tokens.filter((t) => t.start >= lo && t.end <= hi).length;
}

function rosterLines(text: string, pairs: Array<{ text: string; lineIdx: number }>): { lines: Set<number>; scored: boolean } {
  const lines = text.split('\n');
  const rosterIdx = new Set<number>();
  let scored = false;
  for (const p of pairs) {
    const line = lines[p.lineIdx] ?? '';
    const withoutEnum = line.replace(/^\s*\d{1,3}\s*[.)]\s*/u, '');
    const scoreMatch = withoutEnum.match(/\s*[-–—:|]?\s*\d+(?:[.,/]\d+)*\s*%?\s*(?:միավոր|балл\p{L}*|points?)?\s*$/iu);
    const namePart = (scoreMatch ? withoutEnum.slice(0, scoreMatch.index) : withoutEnum).trim().replace(/[,;]$/u, '');
    if (namePart === p.text) {
      rosterIdx.add(p.lineIdx);
      if (scoreMatch) scored = true;
    }
  }
  return { lines: rosterIdx, scored };
}

function findStudentNames(text: string, strongExtra: Span[]): string[] {
  const tokens = tokenize(text);
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (pos: number) => {
    let l = 0;
    while (l + 1 < lineStarts.length && lineStarts[l + 1] <= pos) l++;
    return l;
  };

  const candidates: Array<{ i: number; kind: 'shaped' | 'generic'; text: string; lineIdx: number }> = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    const a = tokens[i];
    const b = tokens[i + 1];
    if (!/^[ \t ]+$/u.test(text.slice(a.end, b.start))) continue; // same line, only spaces between
    const kind = namePairKind(a.word, b.word);
    if (!kind) continue;
    const prev = tokens[i - 1];
    if (prev && STAFF_ROLE.test(prev.word) && !SENTENCE_END.test(text.slice(prev.end, a.start))) continue;
    candidates.push({ i, kind, text: `${a.word} ${b.word}`, lineIdx: lineOf(a.start) });
  }
  if (candidates.length === 0) return [];

  const strong = [...spansOf(STUDENT_CODE, text), ...strongExtra];
  const weak = [...spansOf(CLASS_LABEL, text), ...spansOf(WEAK_WORDS, text)];
  const roster = rosterLines(
    text,
    candidates.filter((c) => c.kind === 'shaped')
  );
  const rosterIsStudentList = roster.lines.size >= 2 && (roster.scored || strong.length > 0 || weak.length > 0);

  const found: string[] = [];
  let lastEnd = -1;
  for (const c of candidates) {
    if (c.i <= lastEnd) continue;
    const from = c.i;
    const to = c.i + 1;
    const start = tokens[from].start;
    const end = tokens[to].end;
    const nearStrong = strong.some((s) => s.start <= end + NEAR_WINDOW && s.end >= start - NEAR_WINDOW);
    const nearWeak = [...strong, ...weak].some((s) => {
      const gap = wordGap(text, tokens, s, from, to);
      return gap !== null && gap <= WEAK_GAP;
    });
    const inRoster = rosterIsStudentList && roster.lines.has(c.lineIdx) && c.kind === 'shaped';
    const flagged = c.kind === 'shaped' ? nearStrong || nearWeak || inRoster : nearWeak;
    if (flagged) {
      found.push(c.text);
      lastEnd = to;
    }
  }
  return found;
}

// ---------------------------------------------------------------- student codes

/**
 * Anonymous student code: 2–3 short segments joined by "-", at least one
 * digit, no word-like segment (≥ 3 letters), not a date.
 * Accepts 7B-14, 7Բ-03, 10A-1, S-2026-017. Rejects Anna, ԱՐԱՄ, 2013-05-14.
 */
export function isAnonymousStudentCode(code: string): boolean {
  const c = code.trim();
  if (!/^[\p{L}\p{N}]{1,4}(?:-[\p{L}\p{N}]{1,4}){1,2}$/u.test(c)) return false;
  if (!/\p{N}/u.test(c)) return false;
  if (c.split('-').some((seg) => /\p{L}{3,}/u.test(seg))) return false;
  if (/^\d{4}-\d{1,2}-\d{1,2}$|^\d{1,2}-\d{1,2}-\d{2,4}$/u.test(c)) return false;
  return true;
}

// ---------------------------------------------------------------- API

export function checkPrivacy(content: string, options: PrivacyOptions = {}): PrivacyCheckResult {
  const text = content || '';
  const findings: PrivacyFinding[] = [];
  const warnings: string[] = [];

  if (options.context === 'student_code') {
    if (!isAnonymousStudentCode(text)) {
      findings.push({ kind: 'invalid_student_code', match: text });
      warnings.push(
        `«${text}» անանուն աշակերտի կոդ չէ: Թույլատրվում է միայն կոդ, օր.՝ 7B-14 (2–3 կարճ հատված՝ գծիկով, առնվազն մեկ թվանշան, առանց անունների և ամսաթվերի):`
      );
    }
    return { hasPii: findings.length > 0, blocked: findings.length > 0, warnings, findings };
  }

  const emails = matchesOf(EMAIL_REGEX, text);
  const phones = findPhones(text);
  if (!options.allowContacts) {
    if (emails.length > 0) {
      findings.push(...emails.map((match) => ({ kind: 'email' as const, match })));
      warnings.push(`Հայտնաբերվել է էլ. փոստի հասցե (${emails.join(', ')}): Պահպանումն արգելափակված է:`);
    }
    if (phones.length > 0) {
      findings.push(...phones.map((match) => ({ kind: 'phone' as const, match })));
      warnings.push(`Հայտնաբերվել է հեռախոսահամար (${phones.join(', ')}): Պահպանումն արգելափակված է:`);
    }
  }

  const births = findBirthDates(text);
  if (births.length > 0) {
    findings.push(...births.map((match) => ({ kind: 'birth_date' as const, match })));
    warnings.push(`Հայտնաբերվել է ծննդյան ամսաթիվ (${births.join(', ')}): Պահպանումն արգելափակված է:`);
  }

  const strongExtra = [
    ...spansOf(DATE, text).filter((d) => births.includes(text.slice(d.start, d.end))),
    ...(options.allowContacts ? [] : [...spansOf(EMAIL_REGEX, text), ...spansOf(PHONE_AM, text), ...spansOf(PHONE_INTL, text)]),
  ];
  const names = findStudentNames(text, strongExtra);
  if (names.length > 0) {
    findings.push(...names.map((match) => ({ kind: 'full_name' as const, match })));
    warnings.push(
      `Հայտնաբերվել է աշակերտի անուն-ազգանուն («${names.join('», «')}») աշակերտի կոդի/դասարանի/կոնտակտի կողքին: Համակարգը թույլատրում է միայն անանուն կոդեր (օր.՝ 7B-14):`
    );
  }

  return { hasPii: findings.length > 0, blocked: findings.length > 0, warnings, findings };
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

// Keys whose values are never scanned: binary / media payloads and hashes.
const SKIP_KEYS = new Set(['imageUrl', 'image', 'imageBase64', 'fileBase64', 'embedding', 'sha256', 'dataSnapshotHash']);

interface Collected {
  lines: string[];
  personalFields: string[];
  studentCodes: Array<{ path: string; value: unknown }>;
}

function collectForGuard(value: unknown, path: string, out: Collected): Collected {
  if (typeof value === 'string' || typeof value === 'number') {
    const key = path.split('.').pop() || '';
    const str = String(value);
    // "key: value" keeps field names as context (dateOfBirth: 2013-05-14).
    out.lines.push(key && !/^\d+$/.test(key) ? `${key}: ${str}` : str);
    if (key && PERSONAL_FIELD.test(key) && str.trim() !== '') out.personalFields.push(`${key}: ${str}`);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => collectForGuard(v, `${path}.${i}`, out));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (SKIP_KEYS.has(k)) continue;
      const p = path ? `${path}.${k}` : k;
      if (k === 'studentCode') {
        out.studentCodes.push({ path: p, value: v });
        continue;
      }
      collectForGuard(v, p, out);
    }
  }
  return out;
}

/**
 * Throws PrivacyViolationError if `value` carries student personal data.
 * Scans every string / number leaf (with its field name as context); any
 * `studentCode` field must be an anonymous code.
 */
export function assertNoPii(value: unknown, where: string, options: PrivacyOptions = {}): void {
  if (options.context === 'student_code') {
    const r = checkPrivacy(typeof value === 'string' ? value : String(value ?? ''), options);
    if (r.blocked) throw new PrivacyViolationError(where, r);
    return;
  }
  const c = collectForGuard(value, '', { lines: [], personalFields: [], studentCodes: [] });
  const result = checkPrivacy(c.lines.join('\n'), options);
  if (c.personalFields.length > 0) {
    result.findings.push(...c.personalFields.map((match) => ({ kind: 'personal_field' as const, match })));
    result.warnings.push(`Անձնական տվյալների դաշտ (${c.personalFields.join(', ')}): Պահպանումն արգելափակված է:`);
  }
  for (const sc of c.studentCodes) {
    if (sc.value === undefined || sc.value === null || sc.value === '') continue;
    const r = checkPrivacy(String(sc.value), { context: 'student_code' });
    result.findings.push(...r.findings);
    result.warnings.push(...r.warnings);
  }
  result.hasPii = result.blocked = result.findings.length > 0;
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
