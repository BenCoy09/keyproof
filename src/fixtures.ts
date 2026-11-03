import type { GuardState, Key, SourceId } from "./types";
import { toYocto } from "./units";

const PK = {
  a: "ed25519:7xK2mQ9fZpLw4Rt8Vb3NcYh6JdSa1EuG5oXiTk9fQa",
  b: "ed25519:Bn4Ty8WcXq2LpR7ZvHs5KdMe9JgUa3FoYi6NtCw1Dx",
  c: "ed25519:Fh3Pq7LsVn9TcWy2RbKd6ZmJe4GuAo8XiYt5NvCw1Q",
  d: "ed25519:Qm8Zr2KtXc5VpLw9NbHs3YdJe7GuTa4FoRi6WnCx1B",
};

const fc = (pk: string, allowance: string | null, receiver: string, methods: string[]): Key => ({
  pk, kind: "fc", allowance, receiver, methods,
});

/** Recorded fixtures for the fictional account agent-ops.testnet. Not live data. */
export const SNAPSHOTS: Record<"before" | "after", Key[]> = {
  before: [
    fc(PK.a, toYocto(1), "v2.ref-finance.testnet", ["swap"]),
    fc(PK.b, toYocto(12), "wrap.testnet", []),
    { pk: PK.c, kind: "full" },
    fc(PK.d, null, "unknown-dex.testnet", ["swap"]),
  ],
  after: [
    fc(PK.a, toYocto(1), "v2.ref-finance.testnet", ["swap"]),
    fc(PK.b, toYocto(2), "wrap.testnet", ["near_deposit"]),
    fc(PK.c, toYocto(1), "v2.ref-finance.testnet", ["swap", "ft_transfer_call"]),
  ],
};

export const SOURCE_LABEL: Record<SourceId, string> = {
  before: "snapshot before fix",
  after: "snapshot after fix",
  live: "live, NEAR testnet RPC",
};

export const SNAPSHOT_EVIDENCE = ["recorded fixture", "not read from chain"];

const GK = {
  full: "ed25519:Lm5Qr9TcWx2YpBn7ZvHs4KdMe8JgUa3FoRi6NtCw1S",
  fc: "ed25519:Ap6Nr2KtXc8VpLw5NbHs9YdJe3GuTa7FoQi4WnCx1D",
};

/** Recorded fixtures for the guard example: kp-agent.testnet guarded by kp-guard.testnet. */
export const GUARD_SNAPSHOTS: Record<"before" | "after", { keys: Key[]; guard: GuardState }> = {
  before: {
    keys: [
      { pk: GK.full, kind: "full" },
      fc(GK.fc, toYocto(1), "kp-guard.testnet", ["spend"]),
    ],
    guard: { owner: "kp-agent.testnet", agent: "kp-agent.testnet", dailyCapNear: 50, payTo: ["kp-owner.testnet", "unknown-dex.testnet"], spentTodayNear: 0 },
  },
  after: {
    keys: [fc(GK.fc, toYocto(1), "kp-guard.testnet", ["spend"])],
    guard: { owner: "kp-owner.testnet", agent: "kp-agent.testnet", dailyCapNear: 2, payTo: ["kp-owner.testnet"], spentTodayNear: 0 },
  },
};
