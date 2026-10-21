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
# Narration text with the "pronounce" respellings applied (captions are never changed).
python3 -I -c 'import json, re, sys
d = json.load(open("script.json")); only = sys.argv[1].split()
for s in d["scenes"]:
    if only and s["id"] not in only: continue
    t = s["voice"]
    for word, say in d.get("pronounce", {}).items():
        t = re.sub(r"\b" + re.escape(word) + r"\b", say, t)
    print(s["id"] + "\t" + t)' "$ONLY" | while IFS=$'\t' read -r ID TEXT; do
  BODY=$(TEXT="$TEXT" MODEL_ID="$MODEL_ID" python3 -I -c 'import json,os
print(json.dumps({"text": os.environ["TEXT"], "model_id": os.environ["MODEL_ID"],
  "voice_settings": {"stability": 0.5, "similarity_boost": 0.8, "style": 0.2, "use_speaker_boost": True}}))')
  CODE=$(curl -s -o "voice/$ID.mp3" -w '%{http_code}' -X POST \
    "https://api.elevenlabs.io/v1/text-to-speech/$VOICE_ID?output_format=mp3_44100_128" \
    -H "xi-api-key: $KEY" -H "Content-Type: application/json" -H "Accept: audio/mpeg" --data "$BODY")
  if [ "$CODE" != "200" ]; then
    echo "Scene $ID failed (HTTP $CODE):"; head -c 300 "voice/$ID.mp3"; echo; rm -f "voice/$ID.mp3"; exit 1
  fi
  SECS=$(afinfo "voice/$ID.mp3" | awk '/estimated duration/ {print $3}')
  echo "  $ID  ${SECS}s"
done
unset KEY
echo "Done. Narration is in tools/hub-video/voice/. Tell Claude and it will time the scenes to it."
