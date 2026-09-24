import { AsyncLocalStorage } from 'async_hooks';
import crypto from 'crypto';

// Model, judge and embedding calls log their prompt and output to the audit
// log. Inside a material review those contain a teacher's document text,
// which must not be kept in general logs. Running the work inside
// withRedactedAudit() makes every audit entry written during it (by any
// provider) keep only a hash and length.

const scope = new AsyncLocalStorage<{ reason: string }>();

export function withRedactedAudit<T>(reason: string, fn: () => Promise<T>): Promise<T> {
  return scope.run({ reason }, fn);
}

export function isAuditRedacted(): boolean {
  return scope.getStore() !== undefined;
}

export function redactForAudit(text: string): string {
  const s = scope.getStore();
  const hash = crypto.createHash('sha256').update(text ?? '').digest('hex').slice(0, 16);
  return `[redacted: ${s?.reason ?? 'document content'}; sha256 ${hash}; ${text?.length ?? 0} chars]`;
}
