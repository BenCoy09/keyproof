import type { Policy, PromiseResult } from "./types";

export function headline(results: PromiseResult[]): string {
  const bad = results.filter((r) => r.verdict === "can be exceeded").length;
  const unk = results.filter((r) => r.verdict === "unknown").length;
  if (bad) return `${bad} of ${results.length} promises can be exceeded`;
  if (unk) return `${unk} of ${results.length} promises could not be determined`;
  return `All ${results.length} promises hold`;
}

export function buildReport(policy: Policy, sourceLabel: string, results: PromiseResult[]): string {
  const body = results.map((r) => {
    const head = `${r.title}: ${r.verdict}\n  keys allow: ${r.allows}\n  decided by: ${r.decidedBy}`;
    const items = r.findings.map((f) => `  - ${f.sentence}\n    ${f.field}\n    Breaks: ${r.line}`);
    return [head, ...items].join("\n");
  });
  return [
    "KeyProof report",
    `${policy.account}, source: ${sourceLabel}`,
    headline(results),
    "",
    ...body,
    "",
    "KeyProof verifies key permissions, not whether the policy itself is sensible.",
  ].join("\n");
}

export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
