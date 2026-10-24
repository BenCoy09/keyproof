export type Key =
  | { pk: string; kind: "full" }
  | { pk: string; kind: "unknown" }
  | { pk: string; kind: "fc"; allowance: string | null; receiver: string; methods: string[] };

export interface Policy {
  account: string;
  cap?: number;
  allow?: string[];
  /** The original sentence for each promise, shown next to a finding. */
  lines: { cap?: string; allow?: string; named?: string; nofull?: string };
}

export type Verdict = "holds" | "can be exceeded" | "unknown";

export interface Finding {
  sentence: string;
  field: string;
}

export interface PromiseResult {
  title: string;
  line: string;
  verdict: Verdict;
  /** What the keys actually allow, for this promise. */
  allows: string;
  /** The key field that decides the verdict. */
  decidedBy: string;
  findings: Finding[];
}

export interface LineReading {
  text: string;
  ok: boolean;
  label: string;
  detail: string;
}

export type SourceId = "before" | "after" | "live";

export interface Reading {
  keys: Key[];
  /** Short facts about where the keys came from, shown as the proof record. */
  evidence: string[];
}
