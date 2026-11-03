#!/usr/bin/env bash
# KeyProof live demo helper.
#   bash live-demo.sh          create a testnet account with risky keys (red demo)
#   bash live-demo.sh keys     show the account's keys
#   bash live-demo.sh fix      remove the risky keys (green demo)
# Testnet only. The account is a throwaway and holds no real money.

STATE="$HOME/.keyproof-demo"
RPCS=("https://rpc.testnet.near.org" "https://test.rpc.fastnear.com")

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; exit 1; }

ensure_cli() {
  if ! command -v near >/dev/null 2>&1; then
    command -v npm >/dev/null 2>&1 || die "npm was not found. Install Node first (sudo apt install -y nodejs npm), then run this again."
    say "Installing the NEAR CLI (one time, about a minute)..."
    npm install -g --prefix "$HOME/.local" near-cli-rs@latest || die "The NEAR CLI install failed. Take a photo of the error and send it to Claude."
    export PATH="$HOME/.local/bin:$PATH"
    grep -q '.local/bin' "$HOME/.bashrc" 2>/dev/null || echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$HOME/.bashrc"
  fi
  near account --help >/dev/null 2>&1 || die "A different 'near' program is installed. Run: npm install -g --prefix \$HOME/.local near-cli-rs@latest  and then: export PATH=\$HOME/.local/bin:\$PATH"
}

fetch_keys() {
  local body out u
  body=$(printf '{"jsonrpc":"2.0","id":"kp","method":"query","params":{"request_type":"view_access_key_list","finality":"final","account_id":"%s"}}' "$1")
  for u in "${RPCS[@]}"; do
    out=$(curl -s -m 20 -X POST "$u" -H 'Content-Type: application/json' -d "$body")
    if [ -n "$out" ] && printf '%s' "$out" | grep -q '"keys"'; then printf '%s' "$out"; return 0; fi
  done
  return 1
}

# pick <json> <full|risky|list>
pick() {
  printf '%s' "$1" | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{
      const ks=(JSON.parse(s).result||{}).keys||[]; const want=process.argv[1]; const out=[];
      for(const k of ks){
        const p=k.access_key.permission, f=p&&p.FunctionCall;
        if(want==="full"&&p==="FullAccess") out.push(k.public_key);
        if(want==="risky"&&f&&f.allowance&&BigInt(f.allowance)>=5n*10n**24n&&(f.method_names||[]).length===0) out.push(k.public_key);
        if(want==="list"){
          const a=f?(f.allowance?(Number(BigInt(f.allowance)/10n**21n)/1000)+" NEAR allowance":"no allowance cap"):"";
          out.push(k.public_key.slice(0,16)+"...  "+(p==="FullAccess"?"FULL ACCESS":"function call, "+f.receiver_id+", "+((f.method_names||[]).length?f.method_names.join(","):"any method")+", "+a));
        }
      }
      console.log(out.join("\n"));
    });' "$2"
}

show_keys() {
  [ -f "$STATE" ] || die "No demo account yet. Run: bash live-demo.sh"
  . "$STATE"
  local k; k=$(fetch_keys "$ACCT") || die "Could not read keys from testnet. Check your internet and try again."
  say "Keys on $ACCT:"; pick "$k" list
}

setup() {
  ensure_cli
  local def="kp-demo-$RANDOM" name acct KEYS SIGN
  say "Step 1 of 4: name your demo account"
  read -r -p "Press Enter to use $def.testnet, or type your own name: " name
  name="${name:-$def}"; name="${name%.testnet}"
  [[ "$name" =~ ^[a-z0-9_-]{2,40}$ ]] || die "Use only lowercase letters, numbers, - or _ (2 to 40 characters)."
  acct="$name.testnet"

  say "Step 2 of 4: creating $acct on testnet (free, paid by the faucet)"
  KEYS="keychain"; SIGN="sign-with-keychain"
  if ! near account create-account sponsor-by-faucet-service "$acct" autogenerate-new-keypair save-to-keychain network-config testnet create; then
    say "The keychain did not work here. Trying a key file instead..."
    KEYS="legacy-keychain"; SIGN="sign-with-legacy-keychain"
    near account create-account sponsor-by-faucet-service "$acct" autogenerate-new-keypair save-to-legacy-keychain network-config testnet create \
      || die "Account creation failed. Take a photo of the error and send it to Claude."
  fi
  printf 'ACCT=%s\nSIGN=%s\nKEYS=%s\n' "$acct" "$SIGN" "$KEYS" > "$STATE"

  say "Step 3 of 4: adding a risky key (12 NEAR allowance, any method)"
  near account add-key "$acct" grant-function-call-access --allowance '12 NEAR' --contract-account-id wrap.testnet --function-names '' \
    autogenerate-new-keypair "save-to-$KEYS" network-config testnet "$SIGN" send || die "Adding the risky key failed. Send Claude a photo of the error."

  say "Step 4 of 4: adding a safe key (1 NEAR allowance, one method)"
  near account add-key "$acct" grant-function-call-access --allowance '1 NEAR' --contract-account-id v2.ref-finance.testnet --function-names swap \
    autogenerate-new-keypair "save-to-$KEYS" network-config testnet "$SIGN" send || die "Adding the safe key failed. Send Claude a photo of the error."

  say "Checking the keys landed..."
  local i k n=0
  for i in 1 2 3 4 5 6; do sleep 4; k=$(fetch_keys "$acct") && n=$(printf '%s' "$k" | grep -o 'public_key' | wc -l); [ "$n" -ge 3 ] && break; done
  pick "$k" list

  cat <<MSG

Done. Your demo account is: $acct

Now in KeyProof:
  1. Open the checker and put this on the FIRST line of the policy:  Account: $acct
  2. Tap the "Live testnet" tab and press Check keys.
  3. You should see red. Record that.

When you are ready for the green half, run:  bash live-demo.sh fix
MSG
}

fix() {
  ensure_cli
  [ -f "$STATE" ] || die "No demo account yet. Run: bash live-demo.sh"
  . "$STATE"
  local k risky full ans
  k=$(fetch_keys "$ACCT") || die "Could not read keys from testnet."
  risky=$(pick "$k" risky | head -1); full=$(pick "$k" full | head -1)
  say "This will remove the risky 12 NEAR key and the full access key from $ACCT."
  echo "The account can't be changed afterwards. That is fine for a demo."
  read -r -p "Continue? [y/N] " ans
  [[ "$ans" =~ ^[Yy]$ ]] || { echo "Cancelled."; exit 0; }
  [ -n "$risky" ] && { say "Removing the risky key..."; near account delete-keys "$ACCT" public-keys "$risky" network-config testnet "$SIGN" send || die "Removing the risky key failed."; }
  [ -n "$full" ] && { say "Removing the full access key (last step)..."; near account delete-keys "$ACCT" public-keys "$full" network-config testnet "$SIGN" send || die "Removing the full access key failed."; }
  sleep 5
  show_keys
  say "Now press Check keys again in KeyProof (Live testnet). It should turn green."
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  case "${1:-setup}" in
    setup) setup ;;
    keys) show_keys ;;
    fix) fix ;;
    *) echo "Use: bash live-demo.sh [setup|keys|fix]" ;;
  esac
fi
