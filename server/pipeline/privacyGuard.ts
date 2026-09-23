export interface PrivacyCheckResult {
  hasPii: boolean;
  warnings: string[];
  blocked: boolean;
}

// Armenian common first and last names patterns
const ARMENIAN_NAMES = [
  'Արմեն', 'Արամ', 'Արթուր', 'Աշոտ', 'Գարիկ', 'Գևորգ', 'Դավիթ', 'Էդգար', 'Հայկ', 'Կարեն',
  'Նարեկ', 'Տիգրան', 'Սարգիս', 'Սամվել', 'Վահան', 'Վահե', 'Անահիտ', 'Անի', 'Գայանե', 'Լիլիթ',
  'Մարիամ', 'Մարինե', 'Նաիրա', 'Սոնա', 'Տաթև', 'Հասմիկ', 'Լուսինե', 'Ռուզան', 'Շուշան',
];

const LASTNAME_SUFFIXES = ['յան', 'եան', 'յանց', 'ունի'];

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_REGEX = /(\+374|0)?\s?(\(?[0-9]{2}\)?)\s?[0-9]{2,3}[-\s]?[0-9]{2,3}[-\s]?[0-9]{2}/g;

export function checkPrivacy(content: string): PrivacyCheckResult {
  const warnings: string[] = [];

  // Check email
  const emails = content.match(EMAIL_REGEX);
  if (emails && emails.length > 0) {
    warnings.push(`Հայտնաբերվել է էլ. փոստի հասցե (${emails.join(', ')}): Պահպանումն արգելափակված է:`);
  }

  // Check phone
  const phones = content.match(PHONE_REGEX);
  if (phones && phones.length > 0) {
    // Filter out common dates or number sequences that look like phone
    const filteredPhones = phones.filter((p) => p.replace(/\D/g, '').length >= 8);
    if (filteredPhones.length > 0) {
      warnings.push(`Հայտնաբերվել է հեռախոսահամար (${filteredPhones.join(', ')}): Պահպանումն արգելափակված է:`);
    }
  }

  // Check Armenian full personal names next to student codes or in raw text
  const words = content.split(/[\s,;:()\n\r]+/);
  for (let i = 0; i < words.length - 1; i++) {
    const w1 = words[i].trim();
    const w2 = words[i + 1].trim();

    const isFirstArm = ARMENIAN_NAMES.includes(w1);
    const isLastArm = LASTNAME_SUFFIXES.some((suf) => w2.endsWith(suf));

    if (isFirstArm && isLastArm) {
      warnings.push(
        `Հայտնաբերվել է աշակերտի/անձի ամբողջական անուն-ազգանուն («${w1} ${w2}»): Համակարգը թույլատրում է միայն անանուն կոդեր (օր.՝ 7B-14):`
      );
      break;
    }
  }

  const hasPii = warnings.length > 0;
  return {
    hasPii,
    warnings,
    blocked: hasPii,
  };
}
