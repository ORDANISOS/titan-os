#!/usr/bin/env bash
# ORDANIS Hub video: generate the ElevenLabs narration, one file per scene, into tools/hub-video/voice/.
# Your ElevenLabs API key is read from the prompt (hidden), used for these requests only, and never saved,
# echoed or put in shell history.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p voice

read -rs -p "Paste your ElevenLabs API key (hidden), then press Return: " KEY; echo
KEY=$(printf '%s' "$KEY" | tr -d '[:space:]')
[ -n "$KEY" ] || { echo "No key entered."; exit 1; }
case "$KEY" in
  sk_*) ;;
  *) echo "That isn't an API key: ElevenLabs API keys start with sk_. It looks like the key's ID was copied."
     echo "Create a new key (Developers > API Keys > Create API Key) and copy it from the window that appears."; exit 1;;
esac

VOICE_NAME=$(python3 -I -c 'import json;print(json.load(open("script.json"))["voice"]["name"])')
VOICE_ID=$(python3 -I -c 'import json;print(json.load(open("script.json"))["voice"].get("voice_id",""))')
MODEL_ID=$(python3 -I -c 'import json;print(json.load(open("script.json"))["voice"]["model_id"])')

# Find the voice by name in your ElevenLabs library when no id is set.
if [ -z "$VOICE_ID" ]; then
  VOICES=$(curl -s "https://api.elevenlabs.io/v1/voices" -H "xi-api-key: $KEY")
  VOICE_ID=$(VOICES="$VOICES" VOICE_NAME="$VOICE_NAME" python3 -I -c 'import json,os
try: vs = json.loads(os.environ["VOICES"]).get("voices", [])
except Exception: vs = []
want = os.environ["VOICE_NAME"].strip().lower()
hit = [v for v in vs if v.get("name", "").strip().lower() == want]
print(hit[0]["voice_id"] if hit else "")')
  if [ -z "$VOICE_ID" ]; then
    echo "Couldn't find a voice named \"$VOICE_NAME\" in your ElevenLabs library. Voices it can see:"
    VOICES="$VOICES" python3 -I -c 'import json,os
try:
    for v in json.loads(os.environ["VOICES"]).get("voices", []): print("  -", v.get("name"))
except Exception: print("  (the voice list could not be read; check the API key)")'
    exit 1
  fi
fi
echo "Voice: $VOICE_NAME"

# Optional: only these scene ids, e.g.  make-voice.sh 01-open 07-close
ONLY="${*:-}"
# Optional: TAKES=3 records several versions of each scene into voice/takes/ (the video's files are left alone)
# so you can listen and pick one. STABILITY (0-1, default 0.5): higher reads more evenly and consistently.
TAKES="${TAKES:-1}"
STABILITY="${STABILITY:-0.5}"
mkdir -p voice/takes
# Narration text with the "pronounce" respellings applied (captions are never changed).
python3 -I -c 'import json, re, sys
d = json.load(open("script.json")); only = sys.argv[1].split()
for s in d["scenes"]:
    if only and s["id"] not in only: continue
    t = s["voice"]
    for word, say in d.get("pronounce", {}).items():
        t = re.sub(r"\b" + re.escape(word) + r"\b", say, t)
    print(s["id"] + "\t" + str(s.get("speed", 1.0)) + "\t" + t)' "$ONLY" | while IFS=$'\t' read -r ID SPEED TEXT; do
  # A scene's "speed" (0.7-1.2, default 1) slows or quickens just that scene.
  BODY=$(TEXT="$TEXT" MODEL_ID="$MODEL_ID" STABILITY="$STABILITY" SPEED="$SPEED" python3 -I -c 'import json,os
print(json.dumps({"text": os.environ["TEXT"], "model_id": os.environ["MODEL_ID"],
  "voice_settings": {"stability": float(os.environ["STABILITY"]), "similarity_boost": 0.8, "style": 0.2, "use_speaker_boost": True, "speed": float(os.environ["SPEED"])}}))')
  for N in $(seq 1 "$TAKES"); do
    if [ "$TAKES" -gt 1 ]; then OUT="voice/takes/$ID-$N.mp3"; else OUT="voice/$ID.mp3"; fi
    CODE=$(curl -s -o "$OUT" -w '%{http_code}' -X POST \
      "https://api.elevenlabs.io/v1/text-to-speech/$VOICE_ID?output_format=mp3_44100_128" \
      -H "xi-api-key: $KEY" -H "Content-Type: application/json" -H "Accept: audio/mpeg" --data "$BODY")
    if [ "$CODE" != "200" ]; then
      echo "Scene $ID failed (HTTP $CODE):"; head -c 300 "$OUT"; echo; rm -f "$OUT"; exit 1
    fi
    SECS=$(afinfo "$OUT" | awk '/estimated duration/ {print $3}')
    echo "  $OUT  ${SECS}s"
  done
done
unset KEY
if [ "$TAKES" -gt 1 ]; then
  echo "Done. Listen to the takes (open tools/hub-video/voice/takes), then tell Claude which number to use for each scene."
else
  echo "Done. Narration is in tools/hub-video/voice/. Tell Claude and it will time the scenes to it."
fi
