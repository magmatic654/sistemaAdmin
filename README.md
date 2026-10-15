# Sistema Administración · LLA-9

App local con Next.js, React, TypeScript y PostgreSQL. Usa la misma base compartida
que `sistemaBodega` y `llaneteramulti`, con registros propios en `administracion`.
No incluye inicio de sesión.

## Secciones

- **Registro:** nueva venta, nueva salida y lectura de tickets.
- **Resumen:** ganancias, cobros, historial de ventas/salidas y pagos pendientes
  a proveedores y empleados.
- **Empleados:** agregar, editar, eliminar/restaurar y consultar comisiones por
  día, semana o mes. Pulsar el nombre abre su detalle.

Fondo blanco, texto grande y controles accesibles. Los proveedores se recuerdan
al confirmar una salida y completan el concepto y el pago de capturas futuras.

## Registro manual y tickets únicos

Las ventas de los otros sistemas nunca se cargan ni suman automáticamente.
Escanear sólo prerrellena el formulario; el administrador debe guardar para
registrar. La captura manual también exige ID, folio o código de ticket.

El servidor resuelve la identidad canónica y PostgreSQL exige UNIQUE(tabla, id).
Otro folio, formato del ID, sesión, reintento o guardado simultáneo no duplica
la venta. Anular el registro conserva la identidad ocupada y su historial.

El código impreso incluye versión, tabla e ID:

```text
LLA1:V:<id>  # ventas: llantas y ventas mixtas
LLA1:P:<id>  # ventas_productos: módulo de productos negro
```

Los cambios de tickets están en `sistema-administracion` de ambos sistemas.
Reimprimir conserva el mismo código. El lector debe emular un teclado y terminar
con Enter. Los tickets anteriores pueden buscarse por folio o ID; si el folio
es ambiguo, se debe usar la identidad completa.

Las consultas externas se limitan a la búsqueda y validación explícita del ticket.
No se modifica stock, documentos de venta, folios, IVA histórico ni archivos
originales. Las cancelaciones de otra app no reescriben el resumen: se revisan y
anulan manualmente aquí. Nuevos abonos sobre un ticket cancelado se rechazan.

## Inicio local

Requiere Node.js 22.18+ y el PostgreSQL local compartido preparado.

1. `npm ci`.
2. Completar `.env.local` a partir de `.env.example`, con la conexión y el UUID
   de la instancia local de desarrollo.
3. Si la base está detenida, ejecutar `npm run dev:db` en `C:\dev\sistemaBodega`.
4. `npm run db:migrate`.
5. `npm run dev` y abrir [Administración](http://127.0.0.1:3002).

El servidor escucha en loopback. Las APIs no requieren login; las escrituras
validan el origen de la petición. El pool comprueba versión, entorno, nombre e
identidad de la base antes de operar. Desarrollo rechaza una instancia productiva.
Las variables privadas, respaldos y datos de QA quedan fuera de Git.

## Cifras y persistencia

Ganancia = entradas − salidas − comisiones generadas en el período.
Los saldos pendientes abarcan todas las fechas. Los pagos parciales se ligan al
registro original y no crean otra compra, gasto o venta. Los importes usan centavos.
Las fechas comerciales corresponden a Ciudad de México; las semanas comienzan
el lunes. No se inventan costos de inventario ni se calcula utilidad fiscal.

Cada entrada tiene una sola comisión opcional y un único empleado. Dar de baja
al empleado conserva su historial. Un pago de comisión se registra una sola vez.
Las operaciones y reintentos se confirman junto con su resultado durable, y los
bloqueos de fila impiden abonos simultáneos por encima del saldo.

Anular excluye el movimiento y sus abonos de los totales, conservando su consulta.
No se permite anular una entrada con comisión pagada. Una anulación no ejecuta
una devolución bancaria.

## Verificación

```powershell
npm test
npm run typecheck
npm run build
npm run test:integration
```

La integración crea su propio `llantas_admin_tests` en 127.0.0.1:55439, ejecuta
pruebas reales y elimina únicamente ese clon. Si ya existe, se detiene sin
sobrescribirlo. No añade fixtures a la base de desarrollo ni a producción.
`--keep` permite retener el clon para QA y escribe `.local/test.env`, ignorado por Git.
Las pruebas del contrato de impresión se ejecutan con `npm run test:ticket-barcodes`
en ambos repositorios de ventas. La impresora y el lector físicos deben probarse
con un ticket real antes del uso operativo.

Las migraciones son aditivas y transaccionales. No se aplicaron a producción ni
se desplegó la aplicación. El código de la app nunca ejecuta migraciones desde
una petición.