import { LessonPlan } from '../../shared/types.js';
import { IModelProvider } from '../providers/modelProvider.js';
import { retrieveChunks } from './retrieval.js';
import { repository } from '../store/repository.js';

export interface GenerateLessonPlanParams {
  thematicPlanId: string;
  rowId: string;
  durationMinutes?: number;
  provider?: IModelProvider;
  modelId?: string;
}

export async function generateLessonPlanFromRow(
  params: GenerateLessonPlanParams
): Promise<LessonPlan> {
  const plan = repository.getThematicPlan(params.thematicPlanId);
  if (!plan) {
    throw new Error(`Thematic plan not found: ${params.thematicPlanId}`);
  }

  const row = plan.rows.find((r) => r.id === params.rowId);
  if (!row) {
    throw new Error(`Row not found: ${params.rowId}`);
  }

  // Retrieve FACT chunks for this subject, grade, and topic
  const { factChunks } = await retrieveChunks(plan.subject, plan.grade, row.topic);

  const durationMinutes = params.durationMinutes || 45;
  const lessonPlanId = `lp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

  // Citations from retrieved FACT sources
  const citations = factChunks.slice(0, 3).map((f) => ({
    chunkId: f.chunk.id,
    quote: f.chunk.text.substring(0, 160) + '...',
    sourceTitle: f.sourceTitle,
  }));

  // Structured stages according to Armenian pedagogical methodology (ԽԻԿ - Խթանում, Իմաստի ընկալում, Կշռադատում)
  const stages = [
    {
      title: 'Կազմակերպչական մաս և Խթանում (Խ-փուլ)',
      durationMinutes: 7,
      teacherActivity: `Ողջույն, նախորդ թեմայի արագ հարցում, մտագրոհ «${row.topic}» թեմայի հիմնաբառերով: Հարցադրում. «Ի՞նչ պատմական նշանակություն ունեցավ այս իրադարձությունը»:`,
      studentActivity: 'Աշակերտները պատասխանում են հարցերին, ձևակերպում են սեփական վարկածները, գրատախտակին նշում առանցքային բառերը:',
      formativeCheck: 'Բանավոր հետադարձ կապ, աշակերտների նախնական գիտելիքների բացահայտում:',
    },
    {
      title: 'Իմաստի ընկալում (Ի-փուլ) — Նոր նյութի ուսումնասիրություն',
      durationMinutes: 20,
      teacherActivity: `Թեմայի առանցքային փաստերի շարադրանք ըստ հաստատված դասագրքի (${plan.subject} ${plan.grade}-րդ դասարան): Քարտեզի և սկզբնաղբյուրների ցուցադրություն: Վերջնարդյունքներ՝ ${row.outcomeCodes.join(', ')}:`,
      studentActivity: 'Աշխատանք դասագրքի տեքստի և քարտեզի հետ: Կարևոր տարեթվերի, հասկացությունների գրանցում տետրերում:',
      formativeCheck: 'Զույգերով կարճ հարցում, փոխադարձ պարզաբանում:',
    },
    {
      title: 'Կշռադատում (Կ-փուլ) — Գիտելիքի ամրապնդում',
      durationMinutes: 12,
      teacherActivity: 'Առաջադրանքների բաշխում (աղյուսակի լրացում, պատճառահետևանքային կապերի որոշում): Քննարկման համակարգում:',
      studentActivity: 'Առաջադրանքների անհատական և խմբային կատարում: Արդյունքների ներկայացում:',
      formativeCheck: 'Ինքնագնահատման թերթիկ կամ կարճ թեստային առաջադրանք (3 հարց):',
    },
    {
      title: 'Անդրադարձ և տնային հանձնարարություն',
      durationMinutes: 6,
      teacherActivity: 'Դասի ամփոփում, ելքի քարտերի (Exit tickets) հավաքագրում: Տնային աշխատանքի հանձնարարում և ուղղորդում:',
      studentActivity: 'Ելքի քարտի լրացում («Ի՞նչ սովորեցի այսօր», «Ի՞նչը մնաց անհասկանալի»): Տնային առաջադրանքի գրանցում:',
      formativeCheck: 'Ելքի քարտերի միջոցով վերջնարդյունքների յուրացման գնահատում:',
    },
  ];

  const objectives = [
    `Ապահովել առարկայական չափորոշչի ${row.outcomeCodes.join(', ')} վերջնարդյունքների յուրացումը:`,
    `Զարգացնել տեքստային և քարտեզային աղբյուրների հետ ինքնուրույն աշխատանքի հմտությունները:`,
    `Խթանել պատճառահետևանքային կապերի վերլուծության կարողությունը:`,
  ];

  const requiredMaterials = [
    `${plan.subject} ${plan.grade}-րդ դասարանի դասագիրք`,
    'Պատմական կամ բնագիտական ուսումնական քարտեզ/ատլաս',
    'Աշխատանքային տետրեր և ելքի քարտեր',
  ];

  const homework = `Կարդալ դասագրքի համապատասխան պարագրաֆը «${row.topic}» թեմայով, պատասխանել վերջում տրված հարցերին և կազմել ժամանակագրական/հասկացութային աղյուսակ:`;

  const lessonPlan: LessonPlan = {
    id: lessonPlanId,
    thematicPlanId: plan.id,
    rowId: row.id,
    subject: plan.subject,
    grade: plan.grade,
    topic: row.topic,
    durationMinutes,
    outcomeCodes: row.outcomeCodes,
    objectives,
    requiredMaterials,
    stages,
    factCitations: citations,
    homework,
    createdAt: new Date().toISOString(),
  };

  return repository.saveLessonPlan(lessonPlan);
}
