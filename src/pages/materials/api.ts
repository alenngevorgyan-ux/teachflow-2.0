import type {
  MaterialAnswerKeyEntry,
  MaterialItem,
  MaterialParagraph,
  MaterialReview,
  Source,
  SourceConfirmationState,
} from '../../../shared/types';

export interface ReviewStatus {
  final: boolean;
  reasons: string[];
  counts: {
    pass: number;
    fail: number;
    needs_review: number;
    not_evaluated: number;
    staleItems: number;
    uncheckedItems: number;
    pendingSuggestions: number;
    pendingRechecks: number;
    executionErrors: number;
    runningRuns: number;
  };
}

export interface MaterialView {
  review: MaterialReview;
  paragraphs: MaterialParagraph[];
  /** Items and key spans at the current revision. */
  structure: { items: MaterialItem[]; answerKey: MaterialAnswerKeyEntry[] };
  unassignedParagraphIds: string[];
  status: ReviewStatus;
  suggestionProblems?: Record<string, string[]>;
}

export interface MaterialSummary {
  id: string;
  fileName: string;
  subject: string;
  grade: number;
  uploadedAt: string;
  revision: string;
  questions: number | null;
  acceptedChanges: number;
  status: ReviewStatus;
}

export type RegistrySource = Source & {
  confirmationState: SourceConfirmationState;
  confirmationReason?: string;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly body?: Record<string, unknown>
  ) {
    super(message);
  }
  get isConflict() {
    return this.status === 409;
  }
}

/** JSON request; a network failure is status 0 so callers can phrase it. */
export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new ApiError(err instanceof Error ? err.message : String(err), 0, 'network');
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new ApiError(typeof data.error === 'string' ? data.error : res.statusText, res.status, data.code as string | undefined, data);
  return data as T;
}

export const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
