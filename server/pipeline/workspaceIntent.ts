import fs from 'fs';
import path from 'path';
import { WorkspaceIntentOutput, WorkspaceIntentSchema } from '../../shared/schemas.js';
import { IModelProvider } from '../providers/modelProvider.js';
import { repository } from '../store/repository.js';
import { assertNoPii } from './privacyGuard.js';

export interface MatchedSource {
  id: string;
  title: string;
  version: string;
  role: string;
}

export interface WorkspaceIntentResult extends WorkspaceIntentOutput {
  resolvedSubject: string;
  resolvedGrade: number;
  matchedSources: MatchedSource[];
}

export interface ParseWorkspaceIntentParams {
  message: string;
  pinnedSubject: string;
  pinnedGrade: number;
  provider: IModelProvider;
  modelId?: string;
}

export async function parseWorkspaceIntent(
  params: ParseWorkspaceIntentParams
): Promise<WorkspaceIntentResult> {
  const { message, pinnedSubject, pinnedGrade, provider, modelId } = params;
  // Chat messages go to an external model: no student PII.
  assertNoPii(message, 'chat.message');

  const promptTemplatePath = path.resolve(process.cwd(), 'server/prompts/workspace_intent.v1.txt');
  let prompt = fs.readFileSync(promptTemplatePath, 'utf-8');
  prompt = prompt
    .replace('{{pinnedSubject}}', pinnedSubject)
    .replace('{{pinnedGrade}}', String(pinnedGrade))
    .replace('{{message}}', message);

  const res = await provider.generateStructured(prompt, WorkspaceIntentSchema, {
    modelId,
    temperature: 0.0,
    actionName: 'workspaceIntentParse',
  });

  const resolvedSubject = res.output.subject || pinnedSubject;
  const resolvedGrade = res.output.grade ?? pinnedGrade;

  // Resolve against the registry: which active FACT sources actually cover
  // this subject/grade. These are shown to the teacher as confirmation
  // chips (title + version) before any generation runs — never silently
  // assumed.
  const matchedSources: MatchedSource[] = repository
    .getSources()
    .filter(
      (s) =>
        s.role === 'FACT' &&
        s.status === 'active' &&
        s.grades.includes(resolvedGrade) &&
        s.subject.toLowerCase() === resolvedSubject.toLowerCase()
    )
    .map((s) => ({ id: s.id, title: s.title, version: s.version, role: s.role }));

  return {
    ...res.output,
    resolvedSubject,
    resolvedGrade,
    matchedSources,
  };
}
