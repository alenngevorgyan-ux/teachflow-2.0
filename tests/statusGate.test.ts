import { describe, expect, it } from 'vitest';
import type { ItemTrace } from '../shared/types.js';
import { evaluateReadyForClassroomGate } from '../server/pipeline/statusGate.js';

function trace(itemId: string, status: ItemTrace['status']): ItemTrace {
  return {
    itemId,
    factSources: [],
    methodRulesApplied: [],
    providerId: 'p',
    modelId: 'm',
    policyVersion: 'v1',
    generatedAt: new Date().toISOString(),
    checks: [],
    status,
  };
}

describe('evaluateReadyForClassroomGate', () => {
  it('passes when every item is PASS', () => {
    const r = evaluateReadyForClassroomGate([trace('a', 'PASS'), trace('b', 'PASS')], []);
    expect(r.ok).toBe(true);
  });

  it('blocks when any item is FAIL, regardless of acceptedWarnings', () => {
    const r = evaluateReadyForClassroomGate(
      [trace('a', 'PASS'), trace('b', 'FAIL')],
      ['a', 'b']
    );
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === 'has_fail') {
      expect(r.failingItemIds).toEqual(['b']);
    } else {
      throw new Error('expected has_fail');
    }
  });

  it('blocks a WARN item that is not in acceptedWarnings', () => {
    const r = evaluateReadyForClassroomGate([trace('a', 'PASS'), trace('b', 'WARN')], []);
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === 'unaccepted_warnings') {
      expect(r.unacceptedWarningItemIds).toEqual(['b']);
    } else {
      throw new Error('expected unaccepted_warnings');
    }
  });

  it('passes a WARN item that is explicitly accepted', () => {
    const r = evaluateReadyForClassroomGate([trace('a', 'PASS'), trace('b', 'WARN')], ['b']);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warningItemIds).toEqual(['b']);
    }
  });

  it('partial acceptance of multiple WARN items still blocks', () => {
    const r = evaluateReadyForClassroomGate(
      [trace('a', 'WARN'), trace('b', 'WARN'), trace('c', 'WARN')],
      ['a', 'c']
    );
    expect(r.ok).toBe(false);
    if (!r.ok && r.reason === 'unaccepted_warnings') {
      expect(r.unacceptedWarningItemIds).toEqual(['b']);
    } else {
      throw new Error('expected unaccepted_warnings');
    }
  });
});
