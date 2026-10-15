const encoder = new TextEncoder();

export const SESSION_COOKIE_NAME = "administracion_session";
export const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 7;

export interface SessionPayload {
  sub: "admin";
  iat: number;
  exp: number;
}

function getSessionSecret(): string | null {
  const secret = process.env.AUTH_SECRET?.trim();
  return secret && secret.length >= 32 ? secret : null;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function stringToBase64Url(value: string): string {
  return bytesToBase64Url(encoder.encode(value));
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function base64UrlToString(value: string): string {
  return new TextDecoder().decode(base64UrlToBytes(value));
}

async function getSigningKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function createSessionToken(now = Date.now()): Promise<string> {
  const secret = getSessionSecret();
  if (!secret) {
    throw new Error("AUTH_SECRET debe existir y contener al menos 32 caracteres.");
  }

  const issuedAt = Math.floor(now / 1000);
  const payload: SessionPayload = {
    sub: "admin",
    iat: issuedAt,
    exp: issuedAt + SESSION_DURATION_SECONDS,
  };
  const encodedPayload = stringToBase64Url(JSON.stringify(payload));
  const key = await getSigningKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(encodedPayload));

  return `${encodedPayload}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

export async function verifySessionToken(token?: string | null): Promise<SessionPayload | null> {
  if (!token) return null;

  const secret = getSessionSecret();
  if (!secret) return null;

  try {
    const [encodedPayload, encodedSignature, extraPart] = token.split(".");
    if (!encodedPayload || !encodedSignature || extraPart) return null;

    const key = await getSigningKey(secret);
    const validSignature = await crypto.subtle.verify(
      "HMAC",
      key,
      base64UrlToBytes(encodedSignature),
      encoder.encode(encodedPayload),
    );
    if (!validSignature) return null;

    const payload = JSON.parse(base64UrlToString(encodedPayload)) as Partial<SessionPayload>;
    const now = Math.floor(Date.now() / 1000);

    if (
      payload.sub !== "admin" ||
      !Number.isInteger(payload.iat) ||
      !Number.isInteger(payload.exp) ||
      (payload.iat as number) > now + 60 ||
      (payload.exp as number) <= now ||
      (payload.exp as number) - (payload.iat as number) > SESSION_DURATION_SECONDS
    ) {
      return null;
    }

    return payload as SessionPayload;
  } catch {
    return null;
  }
}
