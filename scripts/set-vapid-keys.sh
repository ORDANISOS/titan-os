#!/bin/sh
# ELIOT lock-screen notifications: make a VAPID key pair and store it as hub-command secrets.
#
#   sh scripts/set-vapid-keys.sh tkryueqzvgcigvxgjzsp     # demo
#   sh scripts/set-vapid-keys.sh xreeruxuwtmjhvvxvjts     # production (separate keys)
#
# The private key is generated in memory, written to a private temp file (mode 600), sent to Supabase
# with `supabase secrets set --env-file`, and the file is removed. It is never printed or saved in the
# repo. Only the public key is shown (it is meant to be public; hub-command hands it to the app).
#
# Refuses to replace existing keys unless FORCE=1. Replacing keys silences every device that turned
# notifications on, until it turns them off and on again in ELIOT Settings.
set -eu
REF="${1:-}"
case "$REF" in
  tkryueqzvgcigvxgjzsp|xreeruxuwtmjhvvxvjts) ;;
  *) echo "usage: sh scripts/set-vapid-keys.sh <tkryueqzvgcigvxgjzsp|xreeruxuwtmjhvvxvjts>" >&2; exit 1 ;;
esac
if supabase secrets list --project-ref "$REF" 2>/dev/null | grep -q 'VAPID_PRIVATE_KEY' && [ "${FORCE:-0}" != "1" ]; then
  echo "VAPID keys already exist on $REF. Re-run with FORCE=1 to replace them." >&2
  exit 1
fi
umask 077
DIR=$(mktemp -d)
trap 'rm -rf "$DIR"' EXIT INT TERM
node -e '
const c = require("crypto");
const { privateKey } = c.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const j = privateKey.export({ format: "jwk" });
const pub = Buffer.concat([Buffer.from([4]), Buffer.from(j.x, "base64url"), Buffer.from(j.y, "base64url")]).toString("base64url");
require("fs").writeFileSync(process.argv[1],
  `VAPID_PUBLIC_KEY=${pub}\nVAPID_PRIVATE_KEY=${j.d}\nVAPID_SUBJECT=https://eliot.ordanisos.com\n`, { mode: 0o600 });
' "$DIR/vapid.env"
supabase secrets set --env-file "$DIR/vapid.env" --project-ref "$REF"
echo "Done. Public key (safe to share): $(grep '^VAPID_PUBLIC_KEY=' "$DIR/vapid.env" | cut -d= -f2)"
