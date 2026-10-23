#!/usr/bin/env bash
# ORDANIS Hub video: get word-by-word timings for existing narration files (ElevenLabs forced alignment),
# so a word can be spliced cleanly. Nothing is re-recorded. Writes voice/align-<scene>.json.
# Usage: align.sh 01-open 03-apps
# Your ElevenLabs API key is read from the prompt (hidden), used for these requests only, and never saved.
set -euo pipefail
cd "$(dirname "$0")"
[ $# -gt 0 ] || { echo "Name the scenes to align, e.g. align.sh 01-open 03-apps"; exit 1; }

read -rs -p "Paste your ElevenLabs API key (hidden), then press Return: " KEY; echo
KEY=$(printf '%s' "$KEY" | tr -d '[:space:]')
case "$KEY" in sk_*) ;; *) echo "That isn't an API key: ElevenLabs API keys start with sk_."; exit 1;; esac

for ID in "$@"; do
  # The text exactly as it was spoken (with the "pronounce" respellings).
  TEXT=$(ID="$ID" python3 -I -c 'import json, re, os
d = json.load(open("script.json"))
s = next(x for x in d["scenes"] if x["id"] == os.environ["ID"])
t = s["voice"]
for w, say in d.get("pronounce", {}).items(): t = re.sub(r"\b" + re.escape(w) + r"\b", say, t)
print(t)')
  CODE=$(curl -s -o "voice/align-$ID.json" -w '%{http_code}' -X POST "https://api.elevenlabs.io/v1/forced-alignment" \
    -H "xi-api-key: $KEY" -F "file=@voice/$ID.mp3;type=audio/mpeg" -F "text=$TEXT")
  if [ "$CODE" != "200" ]; then
    echo "Scene $ID failed (HTTP $CODE):"; head -c 400 "voice/align-$ID.json"; echo; rm -f "voice/align-$ID.json"; exit 1
  fi
  python3 -I -c 'import json,sys
w = json.load(open(sys.argv[1]))["words"]
print("  " + sys.argv[2] + ": " + ", ".join(f"{x[\"text\"]} {x[\"start\"]:.2f}-{x[\"end\"]:.2f}" for x in w[:5] if x["text"].strip()))' "voice/align-$ID.json" "$ID"
done
unset KEY
echo "Done. Tell Claude and it will splice the word."
