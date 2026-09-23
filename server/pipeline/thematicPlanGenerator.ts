import crypto from 'crypto';
import { CurriculumOutcome, ThematicPlan, ThematicPlanRow } from '../../shared/types.js';
import { IModelProvider } from '../providers/modelProvider.js';
import { repository } from '../store/repository.js';

export interface GenerateThematicPlanParams {
  subject: string;
  grade: number;
  programVersion: string;
  academicYear: string;
  schoolId: string;
  schoolName: string;
  teacherName: string;
  weeklyHours: number;
  totalAnnualHours?: number;
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

  // 3. No outcome from another grade
  const allOutcomes = repository.getOutcomes();
  const otherGradeMap = new Map<string, number>();
  for (const o of allOutcomes) {
    if (o.subject === plan.subject && o.grade !== plan.grade) {
      otherGradeMap.set(o.code, o.grade);
    }
  }

  for (const row of plan.rows) {
    for (const code of row.outcomeCodes || []) {
      if (otherGradeMap.has(code)) {
        errors.push(
          `Այլ դասարանի վերջնարդյունքի կոդ. Թեմա «${row.topic}» պարունակում է ${otherGradeMap.get(code)}-րդ դասարանի կոդ («${code}»): Թույլատրվում են միայն ${plan.grade}-րդ դասարանի կոդերը:`
        );
      }
    }
  }

  // 4. Calendar & Holiday check
  const holidays = plan.calendar?.holidays || [];
  for (const row of plan.rows) {
    if (!row.plannedDates || row.weekNumber < 1 || row.weekNumber > 36) {
      errors.push(`Անվավեր շաբաթ/ժամկետ «${row.topic}» թեմայի համար (շաբաթ #${row.weekNumber}):`);
    }
  }

  return errors;
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

  const targetHours = params.totalAnnualHours || weeklyHours * 34; // 34 study weeks in RA schools
  const outcomes = repository.getConfirmedOutcomes(subject, grade);

  const planId = `plan-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

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

  // Structured topic rows that cover all confirmed outcomes and sum up to targetHours
  let rows: ThematicPlanRow[] = [];

  if (subject === 'Հայոց պատմություն' && grade === 7) {
    const topicTemplates = [
      { topic: 'Արտաշեսյան թագավորության վերելքը: Տիգրան Բ Մեծի գահակալությունը', hours: 4, outcomes: ['ՀՊ-7-1'], assessment: false },
      { topic: 'Հայ-պոնտական դաշինքը և Կապադովկիայի ազատագրումը', hours: 4, outcomes: ['ՀՊ-7-1'], assessment: false },
      { topic: 'Հայկական աշխարհակալ տերության ստեղծումը: Ասորիքի միացումը', hours: 6, outcomes: ['ՀՊ-7-1', 'ՀՊ-7-4'], assessment: true, type: 'formative' as const },
      { topic: 'Տիգրանակերտ նոր մայրաքաղաքի հիմնադրումը և մշակույթը', hours: 6, outcomes: ['ՀՊ-7-2'], assessment: false },
      { topic: 'Հայ-հռոմեական պատերազմը: Լուկուլլոսի արշավանքը և Արածանիի ճակատամարտը', hours: 6, outcomes: ['ՀՊ-7-3'], assessment: false },
      { topic: 'Արտաշատի հաշտության պայմանագիրը (մ.թ.ա. 66 թ.) և դրա նշանակությունը', hours: 6, outcomes: ['ՀՊ-7-3', 'ՀՊ-7-4'], assessment: true, type: 'summative' as const },
      { topic: 'Արտավազդ Բ: Հայաստանը հռոմեա-պարթևական հակամարտության շրջանում', hours: 6, outcomes: ['ՀՊ-7-4'], assessment: false },
      { topic: 'Արտաշեսյան թագավորության անկումը: Տիգրան Դ և Էրատո', hours: 6, outcomes: ['ՀՊ-7-4'], assessment: true, type: 'formative' as const },
      { topic: 'Հին Հայաստանի տնտեսությունը, հասարակական կյանքը և կառավարման համակարգը', hours: 8, outcomes: ['ՀՊ-7-2', 'ՀՊ-7-4'], assessment: false },
      { topic: 'Հին Հայաստանի մշակույթը: Հելլենիզմը Հայաստանում', hours: 8, outcomes: ['ՀՊ-7-2'], assessment: false },
      { topic: 'Արշակունյաց արքայատոհմի հաստատումը: Տրդատ Ա և Հռանդեայի ճակատամարտը', hours: 6, outcomes: ['ՀՊ-7-1'], assessment: false },
      { topic: 'Կիսամյակային և տարեկան ամփոփիչ կրկնություն', hours: 4, outcomes: ['ՀՊ-7-1', 'ՀՊ-7-2', 'ՀՊ-7-3', 'ՀՊ-7-4'], assessment: true, type: 'summative' as const },
    ];

    let currentWeek = 1;
    let accumulatedHours = 0;

    rows = topicTemplates.map((t, idx) => {
      const weeksForTopic = Math.max(1, Math.round(t.hours / weeklyHours));
      const startWeek = currentWeek;
      const endWeek = currentWeek + weeksForTopic - 1;
      currentWeek = endWeek + 1;
      accumulatedHours += t.hours;

      return {
        id: `row-${idx + 1}`,
        topic: t.topic,
        outcomeCodes: t.outcomes,
        plannedHours: t.hours,
        weekNumber: startWeek,
        plannedDates: `Շաբաթ ${startWeek}-${endWeek} (Ուս. տարի)`,
        hasAssessment: t.assessment,
        assessmentType: t.type,
        taught: idx < 3, // first 3 taught in demo
        actualHours: idx < 3 ? t.hours : 0,
        taughtDate: idx < 3 ? `2025-09-${10 + idx * 7}` : undefined,
      };
    });

    // Adjust last row so sum is exactly targetHours
    const currentSum = rows.reduce((acc, r) => acc + r.plannedHours, 0);
    if (currentSum !== targetHours && rows.length > 0) {
      rows[rows.length - 1].plannedHours += targetHours - currentSum;
    }
  } else {
    // Generic generator for other subjects / grades
    const codes = outcomes.map((o) => o.code);
    const numTopics = Math.min(10, Math.max(4, Math.floor(targetHours / 6)));
    const hoursPerTopic = Math.floor(targetHours / numTopics);
    let remaining = targetHours;

    rows = [];
    let currentWeek = 1;
    for (let i = 0; i < numTopics; i++) {
      const isLast = i === numTopics - 1;
      const h = isLast ? remaining : hoursPerTopic;
      remaining -= h;

      const assignedCodes = codes.length > 0 ? [codes[i % codes.length]] : [];
      const isSummative = (i + 1) % 3 === 0 || isLast;

      rows.push({
        id: `row-${i + 1}`,
        topic: `Թեմա ${i + 1}. ${subject} (${grade}-րդ դասարան, ուսուցողական բաժին ${i + 1})`,
        outcomeCodes: assignedCodes,
        plannedHours: h,
        weekNumber: currentWeek,
        plannedDates: `Շաբաթ ${currentWeek}-${currentWeek + Math.max(1, Math.round(h / weeklyHours)) - 1}`,
        hasAssessment: isSummative,
        assessmentType: isSummative ? 'summative' : undefined,
        taught: i === 0,
        actualHours: i === 0 ? h : 0,
        taughtDate: i === 0 ? '2025-09-12' : undefined,
      });

      currentWeek += Math.max(1, Math.round(h / weeklyHours));
    }
  }

  const plan: ThematicPlan = {
    id: planId,
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
