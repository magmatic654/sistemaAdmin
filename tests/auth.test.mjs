import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSessionToken,verifySessionToken,SESSION_COOKIE_NAME,SESSION_DURATION_SECONDS} from '../lib/auth/session.ts';
test('owner sessions are signed, expire and cannot be forged',async()=>{
  const original=process.env.AUTH_SECRET;process.env.AUTH_SECRET='administration-test-secret-at-least-32-characters';
  try{
    assert.equal(SESSION_COOKIE_NAME,'administracion_session');
    const token=await createSessionToken();assert.equal((await verifySessionToken(token)).sub,'admin');
    assert.equal(await verifySessionToken(token+'x'),null);
    assert.equal(await verifySessionToken(await createSessionToken(Date.now()-(SESSION_DURATION_SECONDS+1)*1000)),null);
    assert.equal(await verifySessionToken(await createSessionToken(Date.now()+120000)),null);
    process.env.AUTH_SECRET='short';assert.equal(await verifySessionToken(token),null);
    await assert.rejects(createSessionToken(),/32/);
  }finally{if(original===undefined)delete process.env.AUTH_SECRET;else process.env.AUTH_SECRET=original;}
});
