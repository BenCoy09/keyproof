import "./style.css";
import { check } from "./check";
import { GUARD_SNAPSHOTS, SNAPSHOTS, SNAPSHOT_EVIDENCE, SOURCE_LABEL } from "./fixtures";
import { EXAMPLE_GUARD_POLICY, EXAMPLE_POLICY, parsePolicy, readLines } from "./parse";
import { buildReport, downloadText } from "./report";
import { fetchGuard, fetchKeys, RpcError } from "./rpc";
import { startSim } from "./sim";
import type { Key, Policy, PromiseResult, Reading, SourceId } from "./types";
import { shortKey, toNear } from "./units";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: unknown) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

const mono = (escaped: string) =>
  escaped.replace(/(ed25519:[A-Za-z0-9]+…[A-Za-z0-9]+|\b[a-z0-9_-]+(?:\.[a-z0-9_-]+)*\.testnet\b)/g, '<span class="m">$1</span>');

function renderRules() {
  const rows = readLines($<HTMLTextAreaElement>("pol").value);
  $("rules").innerHTML = rows.length
    ? rows.map((r) => r.ok
        ? `<li><s></s><span><b>${esc(r.label)}</b>${r.detail ? `<span class="d">${esc(r.detail)}</span>` : ""}</span></li>`
        : `<li class="no"><s></s><span><b>${esc(r.label)}</b><span class="d">${esc(r.detail)}</span><span class="note">Fix this line before checking.</span></span></li>`).join("")
    : `<li class="no"><s></s><span><b>No policy yet</b><span class="note">Write one sentence per line.</span></span></li>`;
}

let source: SourceId = "before";
let report = "";
let reportName = "keyproof-report.txt";

function showError(title: string, message: string) {
  $("v").innerHTML = `<div class="err"><b>${esc(title)}</b><p>${esc(message)}</p></div>`;
  $<HTMLButtonElement>("copy").hidden = true;
  $<HTMLButtonElement>("dl").hidden = true;
}

function showSkeleton() {
  $("v").innerHTML =
    '<div class="sk h"></div><div class="sk" style="height:8px"></div><div class="sk" style="width:60%"></div><div class="sk"></div><div class="sk" style="width:85%"></div><div class="sk"></div>';
}

function keyCard(k: Key, cap: number | undefined, max: number, issues: number): string {
  let fill = "";
  let label = "";
  if (k.kind === "full") {
    fill = `<i class="fill bad" style="--w:100%"></i>`;
    label = "full access, no limit";
  } else if (k.kind === "fc") {
    if (k.allowance === null) {
      fill = `<i class="fill bad" style="--w:100%"></i>`;
      label = "no allowance cap";
    } else {
      const n = toNear(k.allowance);
      const over = cap !== undefined && n > cap;
      fill = `<i class="fill${over ? " bad" : ""}" style="--w:${Math.max(2, (n / max) * 100)}%"></i>`;
      label = `${n} NEAR allowance`;
    }
  } else {
    label = "permission type not read";
  }
  const tick = cap !== undefined && k.kind !== "unknown" ? `<u class="cap" style="left:${(cap / max) * 100}%"></u>` : "";
  const type = k.kind === "full" ? "full access" : k.kind === "fc" ? "function call" : "unknown";
  const scope = k.kind === "fc" ? `${k.receiver} · ${k.methods.length ? k.methods.join(", ") : "any method"}` : k.kind === "full" ? "any contract · any method" : "";
  const status = issues ? `<span class="bad">${issues} finding${issues > 1 ? "s" : ""}</span>` : `<span class="ok">within policy</span>`;
  return `<div class="k"><div class="kh"><code>${esc(shortKey(k.pk))}</code>${status}</div><div class="bar">${fill}${tick}</div><div class="kl"><span>${esc(label)}</span><span>${esc(type)}${cap !== undefined && k.kind !== "unknown" ? ` · cap ${cap} NEAR` : ""}</span></div><div class="km">${esc(scope)}</div></div>`;
}

function render(policy: Policy, reading: Reading, results: PromiseResult[], src: SourceId) {
  const { keys } = reading;
  const total = results.length;
  const bad = results.filter((r) => r.verdict === "can be exceeded").length;
  const unk = results.filter((r) => r.verdict === "unknown").length;
  const cls = bad ? "bad" : unk ? "unk" : "ok";
  const n = bad || unk || total;
  const verb = bad ? "can be exceeded" : unk ? "could not be determined" : "hold";

  const issues = new Map<number, number>();
  for (const r of results) for (const f of r.findings) {
    const m = f.field.match(/keys\[(\d+)\]/);
    if (m) issues.set(+m[1], (issues.get(+m[1]) ?? 0) + 1);
  }
  const allowances = keys.flatMap((k) => (k.kind === "fc" && k.allowance !== null ? [toNear(k.allowance)] : []));
  const max = (Math.max(policy.cap ?? 0, ...allowances) * 1.15) || 1;

  let h = `<p class="sum ${cls}"><span class="big">${n}</span><span class="sumt">of ${total} promises<br>${verb}</span></p>`;
  h += `<div class="segs" aria-hidden="true">${results.map((r) => `<i class="${r.verdict === "holds" ? "ok" : r.verdict === "unknown" ? "" : "bad"}" title="${esc(r.title)}"></i>`).join("")}</div>`;
  h += `<p class="meta"><span class="m">${esc(policy.account)}</span> · ${keys.length} keys · ${esc(SOURCE_LABEL[src])}<br>${esc(reading.evidence.join(" · "))}</p>`;

  h += `<div class="vt" role="table"><div class="vr vh" role="row"><span>Promise</span><span>What the keys allow</span><span>Verdict</span><span>Decided by</span></div>`;
  for (const r of results) {
    const c = r.verdict === "holds" ? "ok" : r.verdict === "unknown" ? "unk" : "bad";
    h += `<div class="vr" role="row"><span><b>${esc(r.title)}</b><small>${mono(esc(r.line))}</small></span><span data-l="What the keys allow">${mono(esc(r.allows))}</span><span class="vd ${c}" data-l="Verdict">${r.verdict}</span><span class="fld" data-l="Decided by">${esc(r.decidedBy)}</span></div>`;
  }
  h += `</div>`;

  const failures = results.flatMap((r) => r.findings);
  if (failures.length) {
    h += `<div class="fails"><h2>${failures.length} failure${failures.length > 1 ? "s" : ""}</h2>${failures.map((f) => `<p class="fl">${mono(esc(f.sentence))}<code>${esc(f.field)}</code></p>`).join("")}</div>`;
  }

  h += `<div class="ledger"><h2>Keys read, allowance against the ${policy.cap !== undefined ? policy.cap + " NEAR " : ""}cap</h2><div class="keys" tabindex="0">${keys.map((k, i) => keyCard(k, policy.cap, max, issues.get(i) ?? 0)).join("")}</div></div>`;
  $("v").innerHTML = h;

  report = buildReport(policy, SOURCE_LABEL[src], results);
  reportName = `keyproof-${policy.account}.txt`;
  $<HTMLButtonElement>("copy").hidden = false;
  $<HTMLButtonElement>("dl").hidden = false;
}

async function run(first: boolean) {
  let policy: Policy;
  try {
    policy = parsePolicy($<HTMLTextAreaElement>("pol").value);
  } catch (e) {
    return showError("Policy not recognised", (e as Error).message);
  }
  if (!first) showSkeleton();

  let reading: Reading;
  try {
    if (source === "live") {
      reading = await fetchKeys(policy.account);
      if (policy.guard) {
        try {
          reading.guard = await fetchGuard(policy.guard.account);
          reading.evidence = [...reading.evidence, "guard get_policy read"];
        } catch (e) {
          reading.guard = null;
          reading.evidence = [...reading.evidence, "guard: " + (e instanceof RpcError ? e.message : "unreadable")];
        }
      }
    } else {
      if (!first) await new Promise((r) => setTimeout(r, 350));
      if (policy.guard) {
        const gs = GUARD_SNAPSHOTS[source];
        reading = { keys: gs.keys, guard: gs.guard, evidence: SNAPSHOT_EVIDENCE };
      } else {
        reading = { keys: SNAPSHOTS[source], evidence: SNAPSHOT_EVIDENCE };
      }
    }
  } catch (e) {
    return showError("Could not read keys", e instanceof RpcError ? e.message : "Unexpected error while reading keys.");
  }
  if (reading.keys.length === 0) {
    return showError(
      "No keys found",
      `${policy.account} returned 0 access keys on testnet. KeyProof gives no verdict on zero keys, because “every promise holds” would be a false result. Put your own testnet account on the first policy line, or switch to a snapshot.`
    );
  }
  render(policy, reading, check(policy, reading.keys, reading.guard), source);
}

function route() {
  const tool = location.hash === "#check";
  $("home").hidden = tool;
  $("tool").hidden = !tool;
  if (tool || !location.hash) window.scrollTo(0, 0);
  else document.getElementById(location.hash.slice(1))?.scrollIntoView();
}
window.addEventListener("hashchange", route);

$<HTMLTextAreaElement>("pol").value = EXAMPLE_POLICY;
$("pol").addEventListener("input", renderRules);
renderRules();
document.querySelectorAll<HTMLButtonElement>("#seg button").forEach((b) => {
  b.onclick = () => {
    source = b.dataset.src as SourceId;
    document.querySelectorAll<HTMLButtonElement>("#seg button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
    void run(false);
  };
});
$("go").onclick = () => void run(false);
const loadExample = (text: string) => {
  $<HTMLTextAreaElement>("pol").value = text;
  renderRules();
  void run(false);
};
$("ex-basic").onclick = () => loadExample(EXAMPLE_POLICY);
$("ex-guard").onclick = () => loadExample(EXAMPLE_GUARD_POLICY);
$("dl").onclick = () => downloadText(reportName, report);
$("copy").onclick = async () => {
  const b = $<HTMLButtonElement>("copy");
  try {
    await navigator.clipboard.writeText(report);
    b.textContent = "Copied";
  } catch {
    b.textContent = "Copy failed";
  }
  setTimeout(() => (b.textContent = "Copy report"), 1500);
};
startSim($("proof"));
route();
void run(true);
