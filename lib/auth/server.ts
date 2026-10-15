import { cookies } from 'next/headers';
import { createHash, timingSafeEqual } from 'node:crypto';
import { SESSION_COOKIE_NAME, verifySessionToken } from './session.ts';

export async function isOwner() {
  return Boolean(await verifySessionToken((await cookies()).get(SESSION_COOKIE_NAME)?.value));
}
export function safeEqual(a: string, b: string) {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());
}
export function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  return origin === new URL(request.url).origin;
}
