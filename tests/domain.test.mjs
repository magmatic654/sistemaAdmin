import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cents,date,periodRange,businessToday,commissionAmount,manualLines,parseTicketReference,ticketReference} from '../lib/domain.ts';
import {databaseSettings} from '../lib/db.ts';
test('money uses exact cents and rejects negative, exponent, excessive precision and missing input',()=>{
  assert.equal(cents('123.01'),12301); assert.equal(cents('0',undefined,true),0);
  for(const value of ['-1','1.001','1e2','',null,NaN,'1000000000'])assert.throws(()=>cents(value));
  assert.equal(manualLines([{description:'Servicio',quantity:3,unitPrice:'0.10'}])[0].totalCents,30);
});
test('commissions are optional at call site, exactly calculated, and cannot exceed the income',()=>{
  assert.equal(commissionAmount(11600,'percent','10'),1160);
  assert.equal(commissionAmount(11600,'fixed','50.01'),5001);
  assert.throws(()=>commissionAmount(11600,'percent','101'));
  assert.throws(()=>commissionAmount(11600,'fixed','117'));
});
test('calendar ranges use Monday weeks, complete months and Mexico business dates',()=>{
  assert.deepEqual(periodRange('week','2026-11-01'),{from:'2026-10-26',to:'2026-11-01'});
  assert.deepEqual(periodRange('month','2028-02-22'),{from:'2028-02-01',to:'2028-02-29'});
  assert.equal(businessToday(new Date('2026-10-15T02:00:00Z')),'2026-10-14');
  assert.throws(()=>date('2026-02-30'));
});
test('barcode preserves composite identity, including product and tire IDs that coincide',()=>{
  assert.notEqual(ticketReference('ventas','123'),ticketReference('ventas_productos','123'));
  assert.deepEqual(parseTicketReference('LLA1:P:123'),{kind:'ventas_productos',id:'123'});
  assert.equal(parseTicketReference('LLA1:V:../../123'),null);
});
test('database refuses production from development and alternate inventory connections',()=>{
  const original={...process.env};
  try {
    Object.assign(process.env,{SHARED_DATABASE_MODE:'true',SHARED_DATABASE_ENVIRONMENT:'production',NODE_ENV:'development'});
    assert.throws(()=>databaseSettings(),/producción/);
    process.env.SHARED_DATABASE_ENVIRONMENT='development';process.env.CENTRAL_INVENTORY_DATABASE_URL='';
    assert.throws(()=>databaseSettings(),/exclusivamente/);
  } finally {for(const key of Object.keys(process.env))if(!(key in original))delete process.env[key];Object.assign(process.env,original);}
});
