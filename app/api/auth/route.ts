import { cookies } from 'next/headers';
import { createSessionToken, SESSION_COOKIE_NAME, SESSION_DURATION_SECONDS } from '@/lib/auth/session';
import { safeEqual, sameOrigin } from '@/lib/auth/server';
const attempts = new Map<string, { count: number; until: number }>();
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({error:'Origen no permitido.'},{status:403});
  // A global bucket also limits attempts when the app is directly reachable and proxy headers can be spoofed.
  const now=Date.now(); const bucket=attempts.get('owner');
  if (bucket && bucket.until>now && bucket.count>=10) return Response.json({error:'Demasiados intentos. Espera 15 minutos.'},{status:429});
  const expectedUser=process.env.ADMIN_USERNAME, expectedPassword=process.env.ADMIN_PASSWORD;
  if (!expectedUser || !expectedPassword || (process.env.AUTH_SECRET?.length || 0)<32) return Response.json({error:'Configura el acceso del propietario.'},{status:503});
  let input;
  try { input=await request.json(); } catch { return Response.json({error:'Solicitud inválida.'},{status:400}); }
  if (typeof input.username!=='string' || typeof input.password!=='string' || !safeEqual(input.username,expectedUser) || !safeEqual(input.password,expectedPassword)) {
    attempts.set('owner',{count:bucket && bucket.until>now ? bucket.count+1 : 1,until:bucket && bucket.until>now ? bucket.until : now+900_000});
    return Response.json({error:'Usuario o contraseña incorrectos.'},{status:401});
  }
  attempts.clear();
  (await cookies()).set(SESSION_COOKIE_NAME,await createSessionToken(),{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:SESSION_DURATION_SECONDS});
  return Response.json({ok:true});
}
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return Response.json({error:'Origen no permitido.'},{status:403});
  (await cookies()).delete(SESSION_COOKIE_NAME);
  return Response.json({ok:true});
}
