import fs from 'fs';
import path from 'path';
import { ThematicPlanGenerationOutputSchema } from '../../shared/schemas.js';
import { CurriculumOutcome, ThematicPlan, ThematicPlanRow } from '../../shared/types.js';
import { IModelProvider, getProvider } from '../providers/modelProvider.js';
import { repository } from '../store/repository.js';
import { UserInputError } from './errors.js';

export interface GenerateThematicPlanParams {
  subject: string;
  grade: number;
  programVersion: string;
  academicYear: string;
  schoolId: string;
  schoolName: string;
  teacherName: string;
  weeklyHours: number;
  /**
   * Hours the program requires for the year. There is no safe default: the
   * number comes from the subject program, never from an assumed number of
   * study weeks, so the caller must supply it.
   */
  totalAnnualHours: number;
  provider?: IModelProvider;
  modelId?: string;
}

export function validateThematicPlanDeterministically(
  plan: ThematicPlan,
  outcomes: CurriculumOutcome[]
): string[] {
  const errors: string[] = [];

  // 1. Total hours check
  const sumHours = plan.rows.reduce((acc, r) => acc + (r.plannedHours || 0), 0);
  if (sumHours !== plan.programTargetHours) {
    errors.push(
      `Ժամաքանակի անհամապատասխանություն. Պլանավորված է ${sumHours} ժամ, սակայն ծրագրով պահանջվում է ${plan.programTargetHours} ժամ (տարբերություն՝ ${sumHours - plan.programTargetHours} ժամ):`
    );
  }

  // 2. Mandatory outcomes coverage
  const mandatoryCodes = outcomes.filter((o) => o.confirmed && o.grade === plan.grade && o.subject === plan.subject).map((o) => o.code);
  const coveredCodes = new Set<string>();
  for (const row of plan.rows) {
    for (const code of row.outcomeCodes || []) {
      coveredCodes.add(code);
    }
  }

  const missingMandatory = mandatoryCodes.filter((c) => !coveredCodes.has(c));
  if (missingMandatory.length > 0) {
    errors.push(
      `Բաց թողնված պարտադիր վերջնարդյունքներ. Ծրագրի հետևյալ պարտադիր կոդերը չեն ընդգրկվել պլանում՝ ${missingMandatory.join(', ')}:`
    );
  }

  // 3. No outcome from another grade, and no fully invented code
  const allOutcomes = repository.getOutcomes();
  const otherGradeMap = new Map<string, number>();
  for (const o of allOutcomes) {
    if (o.subject === plan.subject && o.grade !== plan.grade) {
      otherGradeMap.set(o.code, o.grade);
    }
  }
  const allKnownCodes = new Set(allOutcomes.map((o) => o.code));

  for (const row of plan.rows) {
    for (const code of row.outcomeCodes || []) {
      if (otherGradeMap.has(code)) {
        errors.push(
          `Այլ դասարանի վերջնարդյունքի կոդ. Թեմա «${row.topic}» պարունակում է ${otherGradeMap.get(code)}-րդ դասարանի կոդ («${code}»): Թույլատրվում են միայն ${plan.grade}-րդ դասարանի կոդերը:`
        );
      } else if (!allKnownCodes.has(code)) {
        errors.push(
          `Անհայտ վերջնարդյունքի կոդ. Թեմա «${row.topic}» պարունակում է համակարգում գրանցված չգտնվող կոդ («${code}»): Կոդերը թույլատրվում է վերցնել միայն պաշտոնական ցանկից, երբեք չհորինել:`
        );
      }
    }
  }

  // 4. Calendar & holiday check — bounds are driven by THIS plan's own calendar
  // (term1Weeks + term2Weeks, which already net out holiday weeks per the RA
  // school calendar convention), never a hardcoded constant. A schedule that
  // overflows past the real number of teaching weeks fails here.
  const totalTeachingWeeks = plan.calendar.term1Weeks + plan.calendar.term2Weeks;
  for (const row of plan.rows) {
    if (!row.plannedDates || row.weekNumber < 1 || row.weekNumber > totalTeachingWeeks) {
      errors.push(
        `Անվավեր շաբաթ «${row.topic}» թեմայի համար (շաբաթ #${row.weekNumber}): մատչելի է միայն 1-${totalTeachingWeeks} միջակայքը (${plan.calendar.term1Weeks} + ${plan.calendar.term2Weeks} ուսումնական շաբաթ, արձակուրդներից հետո):`
      );
    }
  }

  return errors;
}

function getFactChunksForSubjectGrade(subject: string, grade: number) {
  const sources = repository.getSources();
  const eligible = sources.filter(
    (s) =>
      s.role === 'FACT' &&
      s.status === 'active' &&
      s.grades.includes(grade) &&
      s.subject.toLowerCase() === subject.toLowerCase()
  );
  return eligible.flatMap((s) =>
    s.chunks.map((c) => ({ chunk: c, sourceTitle: s.title, version: s.version }))
  );
}

function requirePositiveInt(value: unknown, field: string, labelHy: string): void {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new UserInputError(
      `«${field}» դաշտը պարտադիր է. ${labelHy} պետք է լինի դրական ամբողջ թիվ (ստացվել է՝ ${value === undefined ? 'բացակայում է' : JSON.stringify(value)}):`
    );
  }
}

export async function generateThematicPlan(params: GenerateThematicPlanParams): Promise<ThematicPlan> {
  const {
    subject,
    grade,
    programVersion,
    academicYear,
    schoolId,
    schoolName,
    teacherName,
    weeklyHours,
  } = params;

  requirePositiveInt(weeklyHours, 'weeklyHours', 'շաբաթական ժամաքանակը');
  requirePositiveInt(params.totalAnnualHours, 'totalAnnualHours', 'ծրագրով պահանջվող տարեկան ժամաքանակը');
  const targetHours = params.totalAnnualHours;
  const outcomes = repository.getConfirmedOutcomes(subject, grade);

  // SPEC: refuse rather than fabricate a plan grounded in nothing.
  if (outcomes.length === 0) {
    throw new Error(
      `«${subject}» առարկայի ${grade}-րդ դասարանի համար հաստատված վերջնարդյունքներ չկան: Թեմատիկ պլանի գեներացումը մերժված է. նախ պետք է հաստատել վերջնարդյունքները Registry բաժնում:`
    );
  }

  const provider = params.provider || getProvider();
  const factChunks = getFactChunksForSubjectGrade(subject, grade);

  const outcomesFormatted = outcomes.map((o) => `[${o.code}] ${o.text}`).join('\n');
  const factChunksFormatted =
    factChunks.length > 0
      ? factChunks
          .map(
            (f) =>
              `CHUNK ID: ${f.chunk.id} (Source: ${f.sourceTitle}, v${f.version})\nTEXT:\n"${f.chunk.text}"`
          )
          .join('\n\n')
      : '(Փաստացի աղբյուրների հատվածներ առկա չեն. հիմնվեք բացառապես հաստատված վերջնարդյունքների վրա)';

  const promptTemplatePath = path.resolve(process.cwd(), 'server/prompts/thematic_plan.v1.txt');
  let prompt = fs.readFileSync(promptTemplatePath, 'utf-8');
  prompt = prompt
    .replace('{{subject}}', subject)
    .replace('{{grade}}', String(grade))
    .replace('{{targetHours}}', String(targetHours))
    .replace('{{weeklyHours}}', String(weeklyHours))
    .replace('{{outcomes}}', outcomesFormatted)
    .replace('{{factChunks}}', factChunksFormatted);

  const res = await provider.generateStructured(prompt, ThematicPlanGenerationOutputSchema, {
    modelId: params.modelId,
    temperature: 0.2,
    actionName: 'generateThematicPlan',
  });

  // Default standard calendar for RA schools (1-st semester 16 weeks, 2-nd semester 18 weeks)
  const calendar = {
    term1Weeks: 16,
    term2Weeks: 18,
    holidays: [
      { name: 'Աշնանային արձակուրդներ', dates: '27.10 - 02.11' },
      { name: 'Ձմեռային արձակուրդներ', dates: '29.12 - 11.01' },
      { name: 'Գարնանային արձակուրդներ', dates: '23.03 - 29.03' },
    ],
  };

  // Deterministic scheduling from the model's proposed topics. Hours are taken
  // exactly as the model returned them — never patched to force-match
  // targetHours; a real mismatch is caught (and can fail) by
  // validateThematicPlanDeterministically below.
  let currentWeek = 1;
  const rows: ThematicPlanRow[] = res.output.topics.map((t, idx) => {
    const weeksForTopic = Math.max(1, Math.round(t.plannedHours / weeklyHours));
    const startWeek = currentWeek;
    const endWeek = currentWeek + weeksForTopic - 1;
    currentWeek = endWeek + 1;

    return {
      id: `row-${idx + 1}`,
      topic: t.topic,
      outcomeCodes: t.outcomeCodes,
      plannedHours: t.plannedHours,
      weekNumber: startWeek,
      plannedDates: `Շաբաթ ${startWeek}-${endWeek}`,
      hasAssessment: t.hasAssessment,
      assessmentType: t.assessmentType,
      // A freshly generated plan has nothing taught yet — no fabricated
      // "already taught" state. Demo history lives only in demo seeding.
      taught: false,
      // Nothing is taught yet, so there are no actual hours. Left undefined
      // rather than 0 — a checked "0 hours taught" is a claim we cannot make.
      actualHours: undefined,
    };
  });

  const plan: ThematicPlan = {
    id: `plan-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    title: `${subject} ${grade}-րդ դասարան — Տարեկան թեմատիկ պլան`,
    subject,
    grade,
    programVersion,
    academicYear,
    schoolId,
    schoolName,
    teacherName,
    weeklyHours,
    totalAnnualHours: targetHours,
    programTargetHours: targetHours,
    status: 'draft',
    calendar,
    rows,
    validationErrors: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  plan.validationErrors = validateThematicPlanDeterministically(plan, outcomes);
  return repository.saveThematicPlan(plan);
}
