#!/usr/bin/env bash
# KeyProof guard demo.
#   bash guard-demo.sh           do everything: accounts, build, deploy, lock down, attack tests
#   bash guard-demo.sh status    show the guard's policy and the agent's keys
# Safe to re-run: finished steps are skipped. Testnet only. Throwaway accounts.

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$HERE/guard" ]; then CRATE="${GUARD_DIR:-$HERE/guard}"; else CRATE="${GUARD_DIR:-$HERE/../contracts/guard}"; fi
STATE="$HOME/.keyproof-guard"
RPCS=("https://rpc.testnet.near.org" "https://test.rpc.fastnear.com")
ONE=1000000000000000000000000

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
good() { printf '  \033[32mPASS\033[0m  %s\n' "$*"; }
bad() { printf '  \033[31mFAIL\033[0m  %s\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }
done_step() { grep -q "^DONE_$1=1" "$STATE" 2>/dev/null; }
mark() { echo "DONE_$1=1" >> "$STATE"; }
save() { grep -v "^$1=" "$STATE" 2>/dev/null > "$STATE.tmp"; echo "$1=$2" >> "$STATE.tmp"; mv "$STATE.tmp" "$STATE"; }

rpc_query() { # <params-json>
  local body out u
  body="{\"jsonrpc\":\"2.0\",\"id\":\"kp\",\"method\":\"query\",\"params\":$1}"
  for u in "${RPCS[@]}"; do
    out=$(curl -s -m 20 -X POST "$u" -H 'Content-Type: application/json' -d "$body")
    if [ -n "$out" ]; then printf '%s' "$out"; return 0; fi
  done
  return 1
}

full_key_of() { # <account>
  rpc_query "{\"request_type\":\"view_access_key_list\",\"finality\":\"final\",\"account_id\":\"$1\"}" | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const ks=((JSON.parse(s).result)||{}).keys||[];
      console.log(ks.filter(k=>k.access_key.permission==="FullAccess").map(k=>k.public_key).join("\n"));});'
}

balance_near() { # <account>
  rpc_query "{\"request_type\":\"view_account\",\"finality\":\"final\",\"account_id\":\"$1\"}" | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
      const r=(JSON.parse(s).result)||{};
      console.log(r.amount?(Number(BigInt(r.amount)/10n**21n)/1000):"unknown");});'
}

need_tools() {
  command -v curl >/dev/null || die "curl is missing. Run: sudo apt install -y curl"
  command -v node >/dev/null || die "node is missing. Run: sudo apt install -y nodejs npm"
  command -v cc >/dev/null || die "A C compiler is missing. Run: sudo apt install -y build-essential"
  if ! command -v rustup >/dev/null && [ ! -x "$HOME/.cargo/bin/rustup" ]; then
    say "Installing Rust (one time, a few minutes)..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain none || die "Rust install failed."
  fi
  [ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
  say "Preparing the Rust toolchain for NEAR contracts..."
  rustup toolchain install stable --profile minimal --target wasm32-unknown-unknown || die "Could not install Rust."
  if ! command -v cargo-near >/dev/null; then
    say "Installing cargo-near..."
    curl --proto '=https' --tlsv1.2 -LsSf https://github.com/near/cargo-near/releases/latest/download/cargo-near-installer.sh | sh \
      || cargo install cargo-near --locked || die "cargo-near install failed. Send Claude a photo of the error."
    [ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
  fi
  if ! command -v near >/dev/null; then
    say "Installing the NEAR CLI..."
    npm install -g --prefix "$HOME/.local" near-cli-rs@latest || die "NEAR CLI install failed."
    export PATH="$HOME/.local/bin:$PATH"
  fi
  near account --help >/dev/null 2>&1 || die "The 'near' program here is not near-cli-rs. Run: npm install -g --prefix \$HOME/.local near-cli-rs@latest; export PATH=\$HOME/.local/bin:\$PATH"
}

create_acct() { # <account>
  near account create-account sponsor-by-faucet-service "$1" autogenerate-new-keypair "save-to-$KEYS" network-config testnet create
}

setup_accounts() {
  done_step accounts && return
  local r="$RANDOM"
  say "Step 1: creating three throwaway testnet accounts (free, paid by the faucet)"
  KEYS="keychain"; SIGN="sign-with-keychain"
  GUARD="kp-guard-$r.testnet"; AGENT="kp-agent-$r.testnet"; OWNER="kp-owner-$r.testnet"
  if ! create_acct "$OWNER"; then
    say "The keychain did not work here. Trying a key file instead..."
    KEYS="legacy-keychain"; SIGN="sign-with-legacy-keychain"
    create_acct "$OWNER" || die "Account creation failed. Send Claude a photo of the error."
  fi
  create_acct "$GUARD" || die "Creating $GUARD failed."
  create_acct "$AGENT" || die "Creating $AGENT failed."
  save KEYS "$KEYS"; save SIGN "$SIGN"; save GUARD "$GUARD"; save AGENT "$AGENT"; save OWNER "$OWNER"
  mark accounts
}

run_unit_tests() {
  done_step tests && return
  say "Step 2: running the contract's own tests (optional, failures here do not stop the demo)"
  (cd "$CRATE" && cargo test 2>&1 | tail -n 15) || echo "  (tests did not run cleanly; continuing)"
  mark tests
}

deploy_guard() {
  done_step deploy && return
  say "Step 3: building and deploying the guard contract (the first build takes several minutes)"
  local args="{\"owner\":\"$OWNER\",\"agent\":\"$AGENT\",\"daily_cap_yocto\":\"$((2*ONE))\",\"pay_to\":[\"$OWNER\"]}"
  # 2 NEAR cap per day, and the only allowed recipient is the owner.
  args=$(printf '{"owner":"%s","agent":"%s","daily_cap_yocto":"2000000000000000000000000","pay_to":["%s"]}' "$OWNER" "$AGENT" "$OWNER")
  (cd "$CRATE" && cargo near deploy build-non-reproducible-wasm "$GUARD" with-init-call new json-args "$args" prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' network-config testnet "$SIGN" send) \
    || die "Build or deploy failed. Send Claude a photo of the LAST 20 lines above."
  mark deploy
}

gen_keypair() { # prints a NEAR public key, then its private key (a throwaway testnet key)
  node -e '
    const c=require("crypto");
    const A="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    const b58=b=>{let n=BigInt("0x"+b.toString("hex")),s="";while(n>0n){s=A[Number(n%58n)]+s;n/=58n}for(const x of b){if(x===0)s="1"+s;else break}return s};
    const j=c.generateKeyPairSync("ed25519").privateKey.export({format:"jwk"});
    const seed=Buffer.from(j.d,"base64url"),pub=Buffer.from(j.x,"base64url");
    console.log("ed25519:"+b58(pub));console.log("ed25519:"+b58(Buffer.concat([seed,pub])));'
}

restrict_agent() {
  done_step restrict && return
  say "Step 4: giving the agent a key that can only call 'spend' on the guard"
  local kp pub priv
  kp=$(gen_keypair); pub=$(printf '%s\n' "$kp" | sed -n 1p); priv=$(printf '%s\n' "$kp" | sed -n 2p)
  [ -n "$pub" ] && [ -n "$priv" ] || die "Could not generate a key for the agent."
  near account add-key "$AGENT" grant-function-call-access --allowance '1 NEAR' --contract-account-id "$GUARD" --function-names spend \
    use-manually-provided-public-key "$pub" network-config testnet "$SIGN" send || die "Adding the agent key failed. Send Claude a photo of the error."
  save AGENT_PUB "$pub"; save AGENT_PRIV "$priv"; chmod 600 "$STATE"
  say "Step 5: removing the agent's full access key, so that key is all it has"
  local fk; fk=$(full_key_of "$AGENT" | head -1)
  [ -n "$fk" ] || die "Could not find the agent's full access key."
  near account delete-keys "$AGENT" public-keys "$fk" network-config testnet "$SIGN" send || die "Removing the full access key failed."
  mark restrict
}

agent_call() { # <method> <json>   signed with the agent's restricted key only
  local out
  out=$(near contract call-function as-transaction "$GUARD" "$1" json-args "$2" prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' \
    sign-as "$AGENT" network-config testnet sign-with-plaintext-private-key "$AGENT_PRIV" send 2>&1)
  if echo "$out" | grep -qE "^Usage:|unexpected argument|tip: to pass"; then
    # older near CLI versions take the keys as flags
    out=$(near contract call-function as-transaction "$GUARD" "$1" json-args "$2" prepaid-gas '100.0 Tgas' attached-deposit '0 NEAR' \
      sign-as "$AGENT" network-config testnet sign-with-plaintext-private-key --signer-public-key "$AGENT_PUB" --signer-private-key "$AGENT_PRIV" send 2>&1)
  fi
  printf '%s\n' "$out"
}

show_policy() {
  near contract call-function as-read-only "$GUARD" get_policy json-args {} network-config testnet now 2>&1 | tail -n 14
}

signing_problem() { echo "$1" | grep -qiE "Cannot sign|does not exist while viewing|fetching the most recent nonce|^Usage:|unexpected argument|tip: to pass"; }
unclear() { printf '  \033[33mUNCLEAR\033[0m  the transaction could not be signed, so this test did not run\n'; }

attack_tests() {
  say "Guard balance: $(balance_near "$GUARD") NEAR (needs a few NEAR to pay out)"
  say "Step 6: attacks, all signed with the agent's restricted key"
  local out

  echo; echo "Test 1: spend 1 NEAR to the owner (allowed, under the 2 NEAR cap)"
  out=$(agent_call spend "{\"to\":\"$OWNER\",\"amount_yocto\":\"$ONE\"}"); echo "$out" | tail -n 5
  if signing_problem "$out"; then unclear
  elif echo "$out" | grep -qiE "panicked|failure|error"; then bad "expected this to succeed"
  else good "allowed spend went through"; fi

  echo; echo "Test 2: spend 1.5 NEAR more (total 2.5, over the 2 NEAR cap)"
  out=$(agent_call spend "{\"to\":\"$OWNER\",\"amount_yocto\":\"1500000000000000000000000\"}"); echo "$out" | tail -n 5
  if signing_problem "$out"; then unclear
  elif echo "$out" | grep -qi "daily cap exceeded"; then good "blocked: daily cap exceeded"
  else bad "expected 'daily cap exceeded'"; fi

  echo; echo "Test 3: pay a stranger account (not on the allowlist)"
  out=$(agent_call spend "{\"to\":\"wrap.testnet\",\"amount_yocto\":\"100000000000000000000000\"}"); echo "$out" | tail -n 5
  if signing_problem "$out"; then unclear
  elif echo "$out" | grep -qi "not on the allowlist"; then good "blocked: recipient is not on the allowlist"
  else bad "expected 'not on the allowlist'"; fi

  echo; echo "Test 4: the agent tries to raise its own cap"
  out=$(agent_call set_daily_cap "{\"daily_cap_yocto\":\"1000000000000000000000000000\"}"); echo "$out" | tail -n 5
  if signing_problem "$out"; then unclear
  elif echo "$out" | grep -qiE "MethodNameMismatch|only the owner|isn.t allowed by the access key"; then good "blocked: the agent's key cannot change the policy"
  else bad "expected a block (see the lines above)"; fi

  say "Policy after the attacks (spent_today should be about 1 NEAR, cap still 2 NEAR):"
  show_policy
}

print_hint() {
  cat <<MSG

To check this on the real chain in KeyProof (npm run dev, then localhost:5173/#check),
paste this policy, choose Live testnet and press Check keys. Every promise should hold:

Account: $AGENT
The agent may only call these contracts: $GUARD
The agent must not hold a full access key.
The agent may only call named methods.
The guard $GUARD caps spending at 2 NEAR per day.
The guard $GUARD may only pay these accounts: $OWNER
MSG
}

redo_agent() {
  [ -f "$STATE" ] || die "Nothing set up yet. Run: bash scripts/guard-demo.sh"
  . "$STATE"
  local new="kp-agent-$RANDOM.testnet"
  say "Creating a fresh agent account: $new"
  create_acct "$new" || die "Creating the new agent failed."
  say "The owner points the guard at the new agent"
  near contract call-function as-transaction "$GUARD" set_agent json-args "{\"agent\":\"$new\"}" prepaid-gas '30.0 Tgas' attached-deposit '0 NEAR' \
    sign-as "$OWNER" network-config testnet "$SIGN" send || die "set_agent failed. Send Claude a photo of the error."
  save AGENT "$new"
  grep -v '^DONE_restrict=1' "$STATE" > "$STATE.tmp"; mv "$STATE.tmp" "$STATE"
  . "$STATE"
  restrict_agent; . "$STATE"
  attack_tests
  print_hint
}

main() {
  need_tools
  [ -f "$STATE" ] && . "$STATE"
  case "${1:-all}" in
    redo-agent) redo_agent; exit 0;;
    attacks) attack_tests; print_hint; exit 0;;
    status)
      [ -f "$STATE" ] || die "Nothing set up yet. Run: bash guard-demo.sh"
      . "$STATE"; show_policy; echo; near account list-keys "$AGENT" network-config testnet now 2>&1 | tail -n 12; exit 0;;
  esac
  setup_accounts; . "$STATE"
  run_unit_tests
  deploy_guard
  restrict_agent; . "$STATE"
  attack_tests
  cat <<MSG

All done. Your accounts:
  guard : $GUARD   (the contract, holds the money)
  agent : $AGENT   (only has a key that can call spend on the guard)
  owner : $OWNER   (the human, the only one who can change the policy)

Send Claude a photo of the test results above.
MSG
  print_hint
}
main "$@"
