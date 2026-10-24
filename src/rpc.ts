import type { Key, Reading } from "./types";

export class RpcError extends Error {}

export const RPC_URL: string = import.meta.env.VITE_NEAR_RPC || "https://rpc.testnet.near.org";

interface RpcKey {
  public_key: string;
  access_key: {
    permission:
      | "FullAccess"
      | { FunctionCall: { allowance: string | null; receiver_id: string; method_names?: string[] } };
  };
}

/**
 * Read-only. Uses the view_access_key_list query. Nothing is signed and
 * no private key ever enters the app.
 */
export async function fetchKeys(account: string): Promise<Reading> {
  let res: Response;
  try {
    res = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "keyproof",
        method: "query",
        params: { request_type: "view_access_key_list", finality: "final", account_id: account },
      }),
    });
  } catch {
    throw new RpcError(`Could not reach ${RPC_URL}. The request was blocked or the network is offline.`);
  }
  if (!res.ok) throw new RpcError(`${RPC_URL} answered with HTTP ${res.status}.`);

  const body = await res.json();
  const err = body.error ?? body.result?.error;
  if (err) {
    if (/does not exist|UNKNOWN_ACCOUNT/i.test(JSON.stringify(body))) {
      throw new RpcError(`Account ${account} was not found on testnet.`);
    }
    const name = typeof err === "string" ? err : err.cause?.name ?? err.name ?? "unknown";
    throw new RpcError(`RPC returned an error: ${name}.`);
  }

  const keys = (body.result.keys as RpcKey[]).map((k): Key => {
    const p = k.access_key.permission;
    if (p === "FullAccess") return { pk: k.public_key, kind: "full" };
    if (p && typeof p === "object" && "FunctionCall" in p) {
      const f = p.FunctionCall;
      return { pk: k.public_key, kind: "fc", allowance: f.allowance, receiver: f.receiver_id, methods: f.method_names ?? [] };
    }
    return { pk: k.public_key, kind: "unknown" };
  });
  const evidence = ["view_access_key_list", "finality final"];
  if (body.result.block_height) evidence.push(`block ${body.result.block_height}`);
  if (body.result.block_hash) evidence.push(`hash ${String(body.result.block_hash).slice(0, 8)}…`);
  return { keys, evidence };
}
