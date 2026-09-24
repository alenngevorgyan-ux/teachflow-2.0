import { describe, expect, it } from 'vitest';
import { isAuditRedacted, redactForAudit, withRedactedAudit } from '../server/providers/auditContext.js';

describe('audit redaction scope', () => {
  it('is off outside and on inside, across awaits', async () => {
    expect(isAuditRedacted()).toBe(false);
    await withRedactedAudit('material review', async () => {
      await new Promise((r) => setTimeout(r, 1));
      expect(isAuditRedacted()).toBe(true);
      const red = redactForAudit('Ո՞վ էր Վարդան Մամիկոնյանը');
      expect(red).not.toContain('Վարդան');
      expect(red).toMatch(/sha256 [0-9a-f]{16}; \d+ chars/);
    });
    expect(isAuditRedacted()).toBe(false);
  });
});
