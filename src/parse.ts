import type { LineReading, Policy } from "./types";

export class PolicyError extends Error {}

export const EXAMPLE_POLICY = `Account: agent-ops.testnet
The agent may spend up to 5 NEAR per day.
The agent may only call these contracts: wrap.testnet, v2.ref-finance.testnet
The agent must not hold a full access key.
The agent may only call named methods.`;

type Parsed =
  | { t: "account"; v: string }
  | { t: "cap"; v: number }
  | { t: "allow"; v: string[] }
  | { t: "nofull" }
  | { t: "named" };

function classify(line: string): Parsed | null {
  let m: RegExpMatchArray | null;
  if ((m = line.match(/^account:\s*(\S+)$/i))) return { t: "account", v: m[1] };
  if ((m = line.match(/up to ([\d.]+) near per day/i))) return { t: "cap", v: parseFloat(m[1]) };
  if ((m = line.match(/only call these contracts:\s*(.+)$/i))) {
    return { t: "allow", v: m[1].replace(/\.$/, "").split(",").map((s) => s.trim()).filter(Boolean) };
  }
  if (/must not hold a full access key/i.test(line)) return { t: "nofull" };
  if (/only call named methods/i.test(line)) return { t: "named" };
  return null;
}

const linesOf = (text: string) => text.split("\n").map((s) => s.trim()).filter(Boolean);

/**
 * Lenient reading of the policy, line by line, for the "rules understood" panel.
 * Unrecognised lines are reported, not dropped.
 */
export function readLines(text: string): LineReading[] {
  return linesOf(text).map((line): LineReading => {
    const p = classify(line);
    if (!p) return { text: line, ok: false, label: "Not recognised", detail: line };
    switch (p.t) {
      case "account": return { text: line, ok: true, label: "Account", detail: p.v };
      case "cap": return { text: line, ok: true, label: "Daily cap", detail: `${p.v} NEAR` };
      case "allow": return { text: line, ok: true, label: `Allowed contracts (${p.v.length})`, detail: p.v.join(", ") };
      case "nofull": return { text: line, ok: true, label: "No full access key", detail: "" };
      case "named": return { text: line, ok: true, label: "Named methods only", detail: "" };
    }
  });
}

/**
 * Strict parse of the fixed template. Unknown lines are rejected instead of
 * ignored: a promise that was silently skipped would be reported as "holds",
 * which is the worst failure for a verification tool.
 */
export function parsePolicy(text: string): Policy {
  const policy: Policy = { account: "", lines: {} };
  for (const line of linesOf(text)) {
    const p = classify(line);
    if (!p) {
      throw new PolicyError(`Line not recognised: “${line}”. Use the sentence forms shown under the policy box.`);
    }
    switch (p.t) {
      case "account": policy.account = p.v; break;
      case "cap": policy.cap = p.v; policy.lines.cap = line; break;
      case "allow": policy.allow = p.v; policy.lines.allow = line; break;
      case "nofull": policy.lines.nofull = line; break;
      case "named": policy.lines.named = line; break;
    }
  }
  if (!policy.account) throw new PolicyError("Add a first line in the form “Account: name.testnet”.");
  if (policy.cap === undefined && !policy.allow && !policy.lines.nofull && !policy.lines.named) {
    throw new PolicyError("No policy sentence found. Add at least one sentence in the forms shown under the policy box.");
  }
  if (policy.cap !== undefined && !Number.isFinite(policy.cap)) throw new PolicyError("The daily cap is not a number.");
  return policy;
}
