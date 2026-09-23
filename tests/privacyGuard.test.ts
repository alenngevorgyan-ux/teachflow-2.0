import { describe, expect, it } from 'vitest';
import {
  PrivacyViolationError,
  assertNoPii,
  assertStudentCode,
  checkPrivacy,
} from '../server/pipeline/privacyGuard.js';

describe('privacyGuard — content context', () => {
  it('does not flag historical names in teaching content', () => {
    for (const text of [
      'Տիգրան Մեծը թագավորել է մ.թ.ա. 95–55 թվականներին:',
      'Խաչատուր Աբովյանի «Վերք Հայաստանի» վեպը',
      'Արամ Խաչատրյանը գրել է «Գայանե» բալետը:',
      'Ստեփան Շահումյան, Հովհաննես Թումանյան, Ավետիք Իսահակյան',
    ]) {
      expect(checkPrivacy(text).blocked, text).toBe(false);
    }
  });

  it('flags a full name next to a student code', () => {
    const r = checkPrivacy('7B-14 Արմեն Պետրոսյան — 18 միավոր');
    expect(r.blocked).toBe(true);
    expect(r.findings).toEqual([{ kind: 'full_name', match: 'Արմեն Պետրոսյան' }]);
  });

  it('flags surname-first order near a class label', () => {
    const r = checkPrivacy('7Բ դասարան\n1. Պետրոսյան Անի — 9\n2. Սարգսյան Նարեկ — 8');
    expect(r.blocked).toBe(true);
    expect(r.findings.map((f) => f.match)).toContain('Պետրոսյան Անի');
  });

  it('flags a historical-looking name only when a student marker is near', () => {
    expect(checkPrivacy('Խաչատուր Աբովյան').blocked).toBe(false);
    expect(checkPrivacy('Աշակերտ Խաչատուր Աբովյանը բացակայել է').blocked).toBe(true);
  });

  it('flags Latin and Cyrillic transliterated names near a class marker', () => {
    expect(checkPrivacy('Class 7B: Armen Petrosyan').blocked).toBe(true);
    expect(checkPrivacy('Ученик 7Б класса Армен Петросян').blocked).toBe(true);
  });

  it('does not flag staff names next to class labels (teacher is not a student)', () => {
    expect(checkPrivacy('Ուսուցիչ՝ Անահիտ Պետրոսյան, 7Բ դասարան').blocked).toBe(false);
  });

  it('always flags emails and phones', () => {
    expect(checkPrivacy('Կապ՝ parent@example.com').findings[0].kind).toBe('email');
    expect(checkPrivacy('Ծնողի հեռ.՝ 055 12 34 56').findings[0].kind).toBe('phone');
    expect(checkPrivacy('+374 91 123456').findings[0].kind).toBe('phone');
  });

  it('flags a name next to a phone even without a class label', () => {
    const r = checkPrivacy('Մարիամ Հակոբյան 093 123 456');
    expect(r.findings.map((f) => f.kind).sort()).toEqual(['full_name', 'phone']);
  });

  it('does not treat years, dates or page ranges as phones', () => {
    for (const text of ['2026–2027 ուսումնական տարի', '01-09-2026', 'էջ 12-45', 'Հարց 1. 0.5 + 0.25 = ?', '0 1 2 3']) {
      expect(checkPrivacy(text).blocked, text).toBe(false);
    }
  });

  it('allows anonymous student codes alone', () => {
    expect(checkPrivacy('7B-14: 18/20, 7B-15: 12/20').blocked).toBe(false);
  });
});

describe('privacyGuard — student code context', () => {
  it('accepts anonymous codes', () => {
    for (const code of ['7B-14', '7Բ-03', '10A-1', 'S-2026-017']) {
      expect(assertStudentCode(code)).toBe(code);
    }
  });

  it('rejects names in a student code, even a single known first name', () => {
    expect(() => assertStudentCode('Արմեն Պետրոսյան')).toThrow(PrivacyViolationError);
    expect(() => assertStudentCode('7B Անի')).toThrow(PrivacyViolationError);
    expect(() => assertStudentCode('Anna Smith')).toThrow(PrivacyViolationError);
  });

  it('rejects a missing code instead of inventing one', () => {
    expect(() => assertStudentCode('')).toThrow(PrivacyViolationError);
    expect(() => assertStudentCode(undefined)).toThrow(PrivacyViolationError);
  });
});

describe('assertNoPii over structured data', () => {
  it('scans nested report fields and table rows', () => {
    const data = {
      subject: 'Պատմություն',
      lowAchievers: [{ code: '7B-14', note: 'Արմեն Պետրոսյան, կրկնել թեման' }],
    };
    expect(() => assertNoPii(data, 'report.data')).toThrow(/7B-14|Արմեն Պետրոսյան/);
  });

  it('passes clean nested data', () => {
    expect(() =>
      assertNoPii({ topic: 'Տիգրան Մեծի կայսրությունը', rows: [{ code: '7B-14', score: 18 }] }, 'report.data')
    ).not.toThrow();
  });
});
