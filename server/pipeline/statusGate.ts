import { ItemTrace } from '../../shared/types.js';

export type ReadyForClassroomGateResult =
  | { ok: true; warningItemIds: string[] }
  | { ok: false; reason: 'has_fail'; failingItemIds: string[] }
  | { ok: false; reason: 'unaccepted_warnings'; unacceptedWarningItemIds: string[] };

// Server-side gate for promoting an assessment to 'ready_for_classroom'.
// Never trust a client-asserted status: recompute from the independently
// generated item traces every time.
export function evaluateReadyForClassroomGate(
  traces: ItemTrace[],
  acceptedWarnings: string[]
): ReadyForClassroomGateResult {
  const failingItemIds = traces.filter((t) => t.status === 'FAIL').map((t) => t.itemId);
  if (failingItemIds.length > 0) {
    return { ok: false, reason: 'has_fail', failingItemIds };
  }

  const warningItemIds = traces.filter((t) => t.status === 'WARN').map((t) => t.itemId);
  const accepted = new Set(acceptedWarnings);
  const unacceptedWarningItemIds = warningItemIds.filter((id) => !accepted.has(id));
  if (unacceptedWarningItemIds.length > 0) {
    return { ok: false, reason: 'unaccepted_warnings', unacceptedWarningItemIds };
  }

  return { ok: true, warningItemIds };
}
