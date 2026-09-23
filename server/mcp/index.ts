import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { Request, Response, Router } from 'express';
import { z } from 'zod';
import { getProvider } from '../providers/modelProvider.js';
import { validateExternalMaterial } from '../pipeline/materialValidator.js';
import { normalizeArmenianText } from '../pipeline/normalization.js';
import { runFullGenerationPipeline } from '../pipeline/orchestrator.js';
import { retrieveChunks } from '../pipeline/retrieval.js';
import { repository } from '../store/repository.js';

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'TeachFlow Curriculum Connector',
    version: '1.0.0',
  });

  // Tool 1: search_curriculum
  server.tool(
    'search_curriculum',
    'Search official confirmed curriculum learning outcomes by subject, grade and keyword query',
    {
      subject: z.string().describe('Subject name (e.g. Բնագիտություն)'),
      grade: z.number().describe('Grade level (e.g. 5)'),
      query: z.string().describe('Search query keyword'),
    },
    async ({ subject, grade, query }) => {
      const outcomes = repository.getConfirmedOutcomes(subject, grade);
      const normQ = normalizeArmenianText(query);
      const filtered = outcomes.filter(
        (o) =>
          normalizeArmenianText(o.text).includes(normQ) ||
          normalizeArmenianText(o.code).includes(normQ)
      );
      const policyVersion = repository.computePolicyVersion();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                policyVersion,
                totalOutcomes: filtered.length,
                outcomes: filtered,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // Tool 2: get_source_fragment
  server.tool(
    'get_source_fragment',
    'Retrieve top verified FACT chunks for a subject, grade, and topic query',
    {
      subject: z.string().describe('Subject name'),
      grade: z.number().describe('Grade level'),
      query: z.string().describe('Topic or concept keyword'),
    },
    async ({ subject, grade, query }) => {
      const { factChunks } = retrieveChunks(subject, grade, query);
      const policyVersion = repository.computePolicyVersion();
      const topFragments = factChunks.slice(0, 5).map((f) => ({
        chunkId: f.chunk.id,
        sourceId: f.sourceId,
        sourceTitle: f.sourceTitle,
        version: f.version,
        page: f.chunk.page ?? 1,
        text: f.chunk.text,
      }));

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                policyVersion,
                fragments: topFragments,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // Tool 3: generate_assessment_with_trace
  server.tool(
    'generate_assessment_with_trace',
    'Generate a curriculum-grounded assessment with item traces, variant equivalence, and source citations',
    {
      subject: z.string(),
      grade: z.number(),
      topic: z.string(),
      sourceIds: z.array(z.string()).optional(),
    },
    async ({ subject, grade, topic, sourceIds }) => {
      const provider = getProvider('gemini');
      const assessment = await runFullGenerationPipeline({
        subject,
        grade,
        topic,
        selectedSourceIds: sourceIds,
        provider,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(assessment, null, 2),
          },
        ],
      };
    }
  );

  // Tool 4: validate_material
  server.tool(
    'validate_material',
    'Validate any arbitrary educational text or ChatGPT test against approved curriculum sources',
    {
      subject: z.string(),
      grade: z.number(),
      text: z.string(),
      sourceIds: z.array(z.string()).optional(),
    },
    async ({ subject, grade, text, sourceIds }) => {
      const provider = getProvider('gemini');
      const report = await validateExternalMaterial(provider, subject, grade, text, sourceIds);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(report, null, 2),
          },
        ],
      };
    }
  );

  return server;
}

export function createMcpRouter(): Router {
  const router = Router();
  const mcpServer = createMcpServer();

  // SSE Transport connection map for Streamable HTTP at /mcp
  let transport: SSEServerTransport | null = null;

  router.get('/mcp/sse', async (req: Request, res: Response) => {
    transport = new SSEServerTransport('/mcp/messages', res);
    await mcpServer.connect(transport);
  });

  router.post('/mcp/messages', async (req: Request, res: Response) => {
    if (transport) {
      await transport.handlePostMessage(req, res);
    } else {
      res.status(400).json({ error: 'SSE connection not established' });
    }
  });

  return router;
}
