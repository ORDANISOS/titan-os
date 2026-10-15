// Web Push for Jarvis (lock-screen alerts), with no third-party library: the VAPID private key is
// only ever handled by the platform's own WebCrypto.
//
// - Message encryption: RFC 8291 (aes128gcm, RFC 8188). The push service (Apple, Google, ...) relays
//   ciphertext it cannot read; only the device can decrypt it.
// - Sender identity: VAPID (RFC 8292), an ES256 JWT signed with VAPID_PRIVATE_KEY.
// - Endpoints are allow-listed to the browser push services, matching the table's CHECK constraint,
//   so a stored row can never make this function POST to any other server.
//
// Keys are base64url: public = 65-byte uncompressed P-256 point, private = 32-byte scalar (the format
// `web-push generate-vapid-keys` and the key commands in docs use).

export const PUSH_ENDPOINT = /^https:\/\/(fcm\.googleapis\.com|web\.push\.apple\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)\//;

const enc = new TextEncoder();

export function b64uEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function b64uDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export type Vapid = { publicKey: string; key: CryptoKey; subject: string };

// Returns null when the keys aren't configured, so push is simply skipped.
export async function loadVapid(publicKey: string, privateKey: string, subject: string): Promise<Vapid | null> {
  if (!publicKey || !privateKey) return null;
  const pub = b64uDecode(publicKey.trim());
  const d = b64uDecode(privateKey.trim());
  if (pub.length !== 65 || pub[0] !== 4 || d.length !== 32) throw new Error("VAPID keys are not in the expected format");
  const key = await crypto.subtle.importKey("jwk", {
    kty: "EC", crv: "P-256", x: b64uEncode(pub.slice(1, 33)), y: b64uEncode(pub.slice(33)), d: b64uEncode(d), ext: false,
  }, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  return { publicKey: publicKey.trim(), key, subject };
}

async function vapidJwt(v: Vapid, endpoint: string): Promise<string> {
  const header = b64uEncode(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64uEncode(enc.encode(JSON.stringify({
    aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: v.subject,
  })));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, v.key, enc.encode(`${header}.${claims}`)));
  return `${header}.${claims}.${b64uEncode(sig)}`;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, k, bytes * 8));
}

// RFC 8291: one aes128gcm record addressed to the device's keys.
export async function encryptPayload(p256dh: string, authSecret: string, plaintext: Uint8Array): Promise<Uint8Array> {
  const uaPublic = b64uDecode(p256dh);
  const auth = b64uDecode(authSecret);
  if (uaPublic.length !== 65 || auth.length !== 16) throw new Error("bad subscription keys");
  const eph = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, eph.privateKey, 256));
  const ikm = await hkdf(auth, ecdhSecret, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, concat(plaintext, new Uint8Array([2]))));
  const rs = new Uint8Array([0, 0, 16, 0]); // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ct);
}

export type PushSub = { endpoint: string; p256dh: string; auth: string };
export type PushMessage = { title: string; body: string; tag: string };

// Returns the push service's HTTP status (201 = accepted; 404/410 = the device is gone).
export async function sendPush(v: Vapid, sub: PushSub, msg: PushMessage, opts: { ttl?: number; urgency?: "normal" | "high" } = {}): Promise<number> {
  if (!PUSH_ENDPOINT.test(sub.endpoint)) throw new Error("endpoint is not a known push service");
  const body = await encryptPayload(sub.p256dh, sub.auth, enc.encode(JSON.stringify(msg)));
  const res = await fetch(sub.endpoint, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
    headers: {
      "Authorization": `vapid t=${await vapidJwt(v, sub.endpoint)}, k=${v.publicKey}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      "TTL": String(opts.ttl ?? 4 * 3600),
      "Urgency": opts.urgency ?? "normal",
      "Topic": msg.tag.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32) || "jarvis",
    },
    body,
  });
  await res.body?.cancel().catch(() => {});
  return res.status;
}
