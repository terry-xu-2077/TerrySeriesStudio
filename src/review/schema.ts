/**
 * Terry Review v1 — AI review output and Word-like comment anchoring.
 *
 * Shared by script-review and storyboard-review; no framework or database dependency.
 * The model proposes comments; the editor alone owns accepting edits and approving text.
 */

export type ReviewSeverity = "important" | "suggestion";

export type ReviewCommentDraft = {
  block_id: string;
  quote: string;
  comment: string;
  replacement?: string;
  severity?: ReviewSeverity;
};

export type ReviewResponse = {
  format: "terry-review";
  version: 1;
  document_revision: string;
  comments: ReviewCommentDraft[];
  summary?: string;
};

/** Pass this to an API adapter as its structured-output schema. */
export const REVIEW_RESPONSE_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["format", "version", "document_revision", "comments"],
  properties: {
    format: { type: "string", const: "terry-review" },
    version: { type: "integer", const: 1 },
    document_revision: { type: "string", minLength: 1 },
    comments: {
      type: "array",
      maxItems: 30,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["block_id", "quote", "comment"],
        properties: {
          block_id: { type: "string", minLength: 1 },
          quote: { type: "string", minLength: 1 },
          comment: { type: "string", minLength: 1 },
          replacement: { type: "string", minLength: 1 },
          severity: { type: "string", enum: ["important", "suggestion"] },
        },
      },
    },
    summary: { type: "string" },
  },
} as const;

export type ReviewSourceBlock = {
  block_id: string;
  text: string;
};

export type ReviewAnchorStatus =
  | "anchored"
  | "stale"
  | "missing-block"
  | "quote-not-found"
  | "ambiguous";

export type ReviewAnchoredComment = ReviewCommentDraft & {
  anchor_status: ReviewAnchorStatus;
  /** JavaScript UTF-16 offsets, relative to the exact source block. */
  start_utf16?: number;
  end_utf16?: number;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonBlank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

/**
 * Minimal runtime validation: do not trust well-formed-looking LLM JSON.
 * This is not a user-facing parser; API adapters must JSON.parse their text first.
 */
export function parseReviewResponse(raw: unknown): ReviewResponse {
  if (!isObject(raw) || !hasOnlyKeys(raw, [
    "format", "version", "document_revision", "comments", "summary",
  ])) {
    throw new Error("Invalid review response object");
  }
  if (raw.format !== "terry-review" || raw.version !== 1 ||
      !nonBlank(raw.document_revision) || !Array.isArray(raw.comments) ||
      raw.comments.length > 30 ||
      (raw.summary !== undefined && typeof raw.summary !== "string")) {
    throw new Error("Invalid Terry Review v1 response");
  }

  for (const item of raw.comments) {
    if (!isObject(item) || !hasOnlyKeys(item, [
      "block_id", "quote", "comment", "replacement", "severity",
    ]) ||
        !nonBlank(item.block_id) || !nonBlank(item.quote) || !nonBlank(item.comment) ||
        (item.replacement !== undefined && !nonBlank(item.replacement)) ||
        (item.severity !== undefined && item.severity !== "important" &&
          item.severity !== "suggestion")) {
      throw new Error("Invalid review comment");
    }
  }
  return raw as ReviewResponse;
}

/**
 * Anchors a reviewed quote only if the revision matches and the quote occurs
 * exactly once in its declared block. Never silently fuzzy-match elsewhere.
 *
 * Review comments (anchored or not) are suggestions, not automatic edits.
 * Before a user accepts an edit, the editor must revalidate the quote against
 * the *current* block text again.
 */
export function anchorReviewComments(
  response: ReviewResponse,
  currentRevision: string,
  blocks: readonly ReviewSourceBlock[],
): ReviewAnchoredComment[] {
  const source = new Map(blocks.map((block) => [block.block_id, block.text]));

  return response.comments.map((comment): ReviewAnchoredComment => {
    const unresolved = (anchor_status: ReviewAnchorStatus): ReviewAnchoredComment =>
      ({ ...comment, anchor_status });

    if (response.document_revision !== currentRevision) return unresolved("stale");

    const text = source.get(comment.block_id);
    if (text === undefined) return unresolved("missing-block");

    const first = text.indexOf(comment.quote);
    if (first < 0) return unresolved("quote-not-found");
    if (text.indexOf(comment.quote, first + 1) !== -1) return unresolved("ambiguous");

    return {
      ...comment,
      anchor_status: "anchored",
      start_utf16: first,
      end_utf16: first + comment.quote.length,
    };
  });
}
