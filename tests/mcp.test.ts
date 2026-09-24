import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CurriculumOutcome, Source, ThematicPlan } from '../shared/types.js';

const store = vi.hoisted(() => ({
  outcomes: [] as CurriculumOutcome[],
  sources: [] as Source[],
  plans: {} as Record<string, ThematicPlan>,
}));

vi.mock('../server/store/repository.js', () => ({
  repository: {
    getConfirmedOutcomes: (subject: string, grade: number) =>
      store.outcomes.filter((o) => o.confirmed && o.subject === subject && o.grade === grade),
    getSources: () => store.sources,
    getOutcomes: () => store.outcomes,
    getThematicPlan: (id: string) => store.plans[id] || null,
    computePolicyVersion: () => 'policy-test-v1',
    getSchools: () => [{ id: 'sch-1', name: 'Test school' }],
    getReportTemplate: () => null,
  },
}));

import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createMcpServer } from '../server/mcp/index.js';

function outcome(overrides: Partial<CurriculumOutcome> = {}): CurriculumOutcome {
  return {
    code: 'BIO-5-1',
    text: 'Ֆոտոսինթեզի գործընթացի բացատրություն',
    subject: 'Բնագիտություն',
    grade: 5,
    standardVersion: 'std-2025',
    sourceId: 'src-1',
    confirmed: true,
    ...overrides,
  };
}

function source(overrides: Partial<Source> = {}): Source {
  return {
    id: 'src-1',
    title: 'Test biology textbook',
    authority: 'test',
    docType: 'textbook',
    subject: 'Բնագիտություն',
    grades: [5],
    role: 'FACT',
    version: '2026-v3', // deliberately different from standardVersion to prove real resolution
    effectiveFrom: '2026-01-01',
    status: 'active',
    sha256: 'x',
    isDemo: true,
    uploadedAt: '2026-01-01',
    chunks: [{ id: 'src-1#p1#c1', sourceId: 'src-1', page: 1, text: 'Ֆոտոսինթեզի մասին տեքստ' }],
    ...overrides,
  };
}

async function connectedClient() {
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

beforeEach(() => {
  store.outcomes = [outcome()];
  store.sources = [source()];
  store.plans = {};
});

describe('MCP tools: policyVersion and source versions are real, not omitted', () => {
  it('search_curriculum returns the current policyVersion and each outcome\'s real source version', async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: 'search_curriculum',
      arguments: { subject: 'Բնագիտություն', grade: 5, query: 'ֆոտոսինթեզ' },
    });

    const text = (result.content as { type: string; text: string }[])[0].text;
    const parsed = JSON.parse(text);

    expect(parsed.policyVersion).toBe('policy-test-v1');
    expect(parsed.outcomes).toHaveLength(1);
    // sourceVersion (registry's actual current version) must be surfaced,
    // and must be the SOURCE's version, not the outcome's own standardVersion.
    expect(parsed.outcomes[0].sourceVersion).toBe('2026-v3');
    expect(parsed.outcomes[0].standardVersion).toBe('std-2025');
  });

  it('get_source_fragment returns policyVersion and a per-fragment version', async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: 'get_source_fragment',
      arguments: { subject: 'Բնագիտություն', grade: 5, query: 'ֆոտոսինթեզ' },
    });

    const text = (result.content as { type: string; text: string }[])[0].text;
    const parsed = JSON.parse(text);

    expect(parsed.policyVersion).toBe('policy-test-v1');
    expect(parsed.fragments[0].version).toBe('2026-v3');
    expect(parsed.fragments[0].sourceId).toBe('src-1');
  });

  it('thematic_plan_validate returns policyVersion alongside the deterministic validation result', async () => {
    store.plans['plan-1'] = {
      id: 'plan-1',
      title: 't',
      subject: 'Բնագիտություն',
      grade: 5,
      programVersion: 'v',
      academicYear: '2026-2027',
      schoolId: 's',
      schoolName: 's',
      teacherName: 't',
      weeklyHours: 2,
      totalAnnualHours: 2,
      programTargetHours: 2,
      status: 'draft',
      calendar: { term1Weeks: 16, term2Weeks: 18, holidays: [] },
      validationErrors: [],
      createdAt: '',
      updatedAt: '',
      rows: [
        {
          id: 'row-1',
          topic: 't',
          outcomeCodes: ['BIO-5-1'],
          plannedHours: 2,
          weekNumber: 1,
          plannedDates: '01.09-05.09',
          hasAssessment: false,
        },
      ],
    };

    const client = await connectedClient();
    const result = await client.callTool({ name: 'thematic_plan_validate', arguments: { planId: 'plan-1' } });
    const text = (result.content as { type: string; text: string }[])[0].text;
    const parsed = JSON.parse(text);

    expect(parsed.policyVersion).toBe('policy-test-v1');
    expect(parsed.valid).toBe(true);
  });

  it('lists all 12 tools', async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.length).toBe(12);
    expect(tools.map((t) => t.name)).toContain('search_curriculum');
    expect(tools.map((t) => t.name)).toContain('lesson_plan_generate');
  });
});

describe('MCP legacy_report_extract invents no metadata', () => {
  it('rejects a call with only rawText instead of defaulting file, form, school and author', async () => {
    const client = await connectedClient();
    const result = await client.callTool({ name: 'legacy_report_extract', arguments: { rawText: 'text' } });
    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text: string }[])[0].text;
    for (const key of ['fileName', 'templateId', 'schoolId', 'authorName']) {
      expect(text).toContain(key);
    }
  });

  it('rejects an unknown school instead of using a hardcoded school name', async () => {
    const client = await connectedClient();
    const result = await client.callTool({
      name: 'legacy_report_extract',
      arguments: { rawText: 'text', fileName: 'f.txt', templateId: 'tpl-program-progress', schoolId: 'sch-nope', authorName: 'A' },
    });
    expect(result.isError).toBe(true);
    expect((result.content as { type: string; text: string }[])[0].text).toContain('sch-nope');
  });
});
