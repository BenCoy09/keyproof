import type { Finding, GuardState, Key, Policy, PromiseResult } from "./types";
import { shortKey, toNear } from "./units";

type FC = Extract<Key, { kind: "fc" }>;
type Rule = (key: Key, index: number, findings: Finding[]) => void;

/**
 * Pure function: policy + keys in, one verdict per promise out.
 * A promise gets "unknown" only if no key broke it but some key had a
 * permission type this tool does not read.
 */
export function check(policy: Policy, keys: Key[], guard?: GuardState | null): PromiseResult[] {
  const results: PromiseResult[] = [];
  const fcs = keys.filter((k): k is FC => k.kind === "fc");
  const full = keys.filter((k) => k.kind === "full").length;

  const unlimited = full + fcs.filter((k) => k.allowance === null).length;
  const finite = fcs.flatMap((k) => (k.allowance === null ? [] : [toNear(k.allowance)]));
  const capAllows =
    [
      unlimited ? `${unlimited} key${unlimited > 1 ? "s" : ""} with no limit` : "",
      finite.length ? `highest allowance ${Math.max(...finite)} NEAR` : "",
    ].filter(Boolean).join(" · ") || "no keys";
  const receivers = [...new Set(fcs.map((k) => k.receiver))];
  const allowAllows = [...receivers, ...(full ? ["any contract"] : [])].join(", ") || "none";
  const anyMethod = fcs.filter((k) => k.methods.length === 0).length;
  const methodAllows = anyMethod
    ? `${anyMethod} of ${fcs.length} function call keys can call any method`
    : fcs.length ? "every function call key names its methods" : "no function call keys";
  const fullAllows = `${full} full access key${full === 1 ? "" : "s"}`;

  const promise = (title: string, line: string | undefined, allows: string, rule: Rule) => {
    if (!line) return;
    const findings: Finding[] = [];
    let unreadable = false;
    keys.forEach((key, i) => {
      if (key.kind === "unknown") {
        unreadable = true;
        return;
      }
      rule(key, i, findings);
    });
    results.push({
      title,
      line,
      allows,
      decidedBy: findings.length ? findings[0].field + (findings.length > 1 ? ` (+${findings.length - 1} more)` : "") : "none",
      findings,
      verdict: findings.length ? "can be exceeded" : unreadable ? "unknown" : "holds",
    });
  };

  promise("Daily spend cap", policy.lines.cap, capAllows, (k, i, out) => {
    const who = shortKey(k.pk);
    if (k.kind === "full") {
      out.push({ sentence: `${who} has full access, so nothing limits what it can spend.`, field: `keys[${i}].permission = "FullAccess"` });
    } else if (k.kind === "fc") {
      if (k.allowance === null) {
        out.push({ sentence: `${who} has no allowance cap, so it can spend without limit.`, field: `keys[${i}].allowance = null` });
      } else if (policy.cap !== undefined && toNear(k.allowance) > policy.cap) {
        const n = toNear(k.allowance);
        out.push({ sentence: `${who} has an allowance of ${n} NEAR, above the ${policy.cap} NEAR daily cap.`, field: `keys[${i}].allowance = ${n} NEAR` });
      }
    }
  });

  promise("Contract allowlist", policy.lines.allow, allowAllows, (k, i, out) => {
    const who = shortKey(k.pk);
    if (k.kind === "full") {
      out.push({ sentence: `${who} has full access, so it can call any contract.`, field: `keys[${i}].permission = "FullAccess"` });
    } else if (k.kind === "fc" && !(policy.allow ?? []).includes(k.receiver)) {
      out.push({ sentence: `${who} can call ${k.receiver}, which is not on the allowlist.`, field: `keys[${i}].receiver_id = "${k.receiver}"` });
    }
  });

  promise("Named methods only", policy.lines.named, methodAllows, (k, i, out) => {
    if (k.kind === "fc" && k.methods.length === 0) {
      out.push({ sentence: `${shortKey(k.pk)} can call any method on ${k.receiver}.`, field: `keys[${i}].method_names = []` });
    }
  });

  promise("No full access keys", policy.lines.nofull, fullAllows, (k, i, out) => {
    if (k.kind === "full") {
      out.push({ sentence: `${shortKey(k.pk)} has full access.`, field: `keys[${i}].permission = "FullAccess"` });
    }
  });

  // ---- guard contract promises (only when the policy names a guard) ----
  const g = policy.guard;
  if (g) {
    const decided = (f: Finding[]) => (f.length ? f[0].field + (f.length > 1 ? ` (+${f.length - 1} more)` : "") : "none");
    const unknown = (title: string, line: string) =>
      results.push({ title, line, allows: "guard policy could not be read", decidedBy: "none", findings: [], verdict: "unknown" });

    if (policy.lines.guardCap) {
      if (!guard) unknown("Guard spend cap", policy.lines.guardCap);
      else {
        const f: Finding[] = [];
        if (g.cap !== undefined && guard.dailyCapNear > g.cap) {
          f.push({ sentence: `${g.account} allows ${guard.dailyCapNear} NEAR per day, above the ${g.cap} NEAR limit.`, field: `guard.daily_cap = ${guard.dailyCapNear} NEAR` });
        }
        results.push({ title: "Guard spend cap", line: policy.lines.guardCap, allows: `${g.account} allows ${guard.dailyCapNear} NEAR per day`, decidedBy: decided(f), findings: f, verdict: f.length ? "can be exceeded" : "holds" });
      }
    }

    if (policy.lines.guardPay) {
      if (!guard) unknown("Guard recipients", policy.lines.guardPay);
      else {
        const f: Finding[] = guard.payTo
          .filter((a) => !(g.pay ?? []).includes(a))
          .map((a) => ({ sentence: `${g.account} can pay ${a}, which is not on the allowed list.`, field: `guard.pay_to includes "${a}"` }));
        results.push({ title: "Guard recipients", line: policy.lines.guardPay, allows: `pays ${guard.payTo.join(", ") || "nobody"}`, decidedBy: decided(f), findings: f, verdict: f.length ? "can be exceeded" : "holds" });
      }
    }

    const controlLine = policy.lines.guardCap ?? policy.lines.guardPay;
    if (controlLine) {
      if (!guard) unknown("Guard control", controlLine);
      else {
        const f: Finding[] = [];
        if (guard.agent !== policy.account) {
          f.push({ sentence: `${g.account} pays ${guard.agent}, not ${policy.account}.`, field: `guard.agent = "${guard.agent}"` });
        }
        if (guard.owner === policy.account) {
          f.push({ sentence: `${policy.account} owns its own guard, so it can change the rules.`, field: `guard.owner = "${guard.owner}"` });
        }
        results.push({ title: "Guard control", line: controlLine, allows: `owner ${guard.owner}, pays ${guard.agent}`, decidedBy: decided(f), findings: f, verdict: f.length ? "can be exceeded" : "holds" });
      }
    }
  }

  return results;
}
