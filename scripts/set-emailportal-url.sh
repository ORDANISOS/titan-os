#!/bin/sh
# ELIOT -> email portal: give the read-only login (eliot_reader) a fresh password and point
# hub-command's EMAILPORTAL_DB_URL at it, without the password ever being printed or saved.
#
#   sh scripts/set-emailportal-url.sh <host> <port> <user>
#   e.g. sh scripts/set-emailportal-url.sh aws-0-us-east-1.pooler.supabase.com 6543 eliot_reader.reaygtuyysfbmblwnjlf
#
# What it does:
#   1. Makes a random 32-character password in memory.
#   2. Writes EMAILPORTAL_DB_URL to a private temp file (mode 600) and sets it as a secret on the
#      production platform project (xreeruxuwtmjhvvxvjts); the file is deleted on exit.
#   3. Puts "alter role eliot_reader with password '...';" on your clipboard. Paste it into the
#      EMAIL PORTAL project's SQL editor and run it. Then press Enter here; the clipboard is cleared.
# Until step 3 is run, ELIOT's email lookups fail (they recover as soon as it is).
set -eu
HOST="${1:-}"; PORT="${2:-}"; DBUSER="${3:-}"
case "$HOST" in *.pooler.supabase.com|db.reaygtuyysfbmblwnjlf.supabase.co) ;; *) echo "usage: sh scripts/set-emailportal-url.sh <host> <port> <user>  (host must be the Supabase pooler or db.reaygtuyysfbmblwnjlf.supabase.co)" >&2; exit 1 ;; esac
case "$PORT" in 5432|6543) ;; *) echo "port must be 5432 or 6543" >&2; exit 1 ;; esac
case "$DBUSER" in eliot_reader|eliot_reader.reaygtuyysfbmblwnjlf) ;; *) echo "user must be eliot_reader or eliot_reader.reaygtuyysfbmblwnjlf" >&2; exit 1 ;; esac
command -v pbcopy >/dev/null || { echo "needs macOS pbcopy" >&2; exit 1; }
umask 077
DIR=$(mktemp -d)
trap 'rm -rf "$DIR"; unset PW' EXIT INT TERM
PW=$(node -e 'process.stdout.write(require("crypto").randomBytes(24).toString("base64url"))')
printf 'EMAILPORTAL_DB_URL=postgresql://%s:%s@%s:%s/postgres\n' "$DBUSER" "$PW" "$HOST" "$PORT" > "$DIR/e.env"
supabase secrets set --env-file "$DIR/e.env" --project-ref xreeruxuwtmjhvvxvjts
printf "alter role eliot_reader with password '%s';\n" "$PW" | pbcopy
unset PW
echo ""
echo "Secret set. The matching SQL is on your clipboard."
echo "Now: open the EMAIL PORTAL project's SQL editor (ref reaygtuyysfbmblwnjlf), paste, Run."
printf "Press Enter after it has run, to clear the clipboard... "
read _
printf '' | pbcopy
echo "Clipboard cleared. Done."
