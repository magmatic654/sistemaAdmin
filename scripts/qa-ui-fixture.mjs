import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
const target = new URL(process.env.SHARED_DATABASE_URL);
assert.equal(target.hostname, "127.0.0.1");
assert.equal(target.port, "55439");
assert.equal(target.pathname, "/llantas_admin_source_tests");
process.loadEnvFile(new URL("../.local/maintenance.env", import.meta.url));
const maintenance = new URL(process.env.QA_MAINTENANCE_URL);
assert.equal(maintenance.hostname, target.hostname);
assert.equal(maintenance.port, target.port);
maintenance.pathname = target.pathname;
const client = new pg.Client({ connectionString: maintenance.toString() });
await client.connect();
try {
  const service = (
    await client.query("SELECT id FROM public.servicios LIMIT 1")
  ).rows[0];
  assert.ok(service);
  const id = Date.now() + "-" + randomUUID().slice(0, 7),
    folio = "QA-LECTOR-" + randomUUID().slice(0, 6);
  const item = {
    tipo: "servicio",
    servicioId: service.id,
    servicioNombre: "Alineación de prueba",
    cantidad: 2,
    precioUnitario: 580,
    subtotal: 1160,
    costoUnitario: null,
    costoSubtotal: null,
  };
  await client.query(
    `INSERT INTO public.ventas(id,folio,cliente,items,subtotal,iva,total,"metodoPago","fechaVenta",origen_app,garantia)
    VALUES($1,$2,$3::jsonb,$4::jsonb,1000,160,1160,'tarjeta',now(),'negra',$5::jsonb)`,
    [
      id,
      folio,
      JSON.stringify({ nombre: "Cliente lector QA", telefono: "5550000000" }),
      JSON.stringify([item]),
      JSON.stringify({
        id: "",
        diasGarantia: 0,
        activa: false,
        fechaInicio: "",
        fechaFin: "",
      }),
    ],
  );
  console.log(
    JSON.stringify({ code: "LLA1:V:" + id, folio, totalCents: 116000 }),
  );
} finally {
  await client.end();
}
