# Sistema Administración · LLA-9

App local con Next.js, React, TypeScript y PostgreSQL, sin inicio de sesión.
Guarda ventas manuales, empleados, gastos y liquidaciones en una base propia.
Consulta la base de `sistemaBodega` y `llaneteramulti` con una conexión de sólo lectura.

## Secciones

- **Registro:** nueva venta, nueva salida y lectura de tickets.
- **Ganancia:** ventas confirmadas menos gastos y comisiones del periodo.
- **Pagos pendientes:** deudas de todas las fechas, agrupadas por empleado o proveedor.
- **Historial:** ventas, gastos y comisiones del periodo elegido.
- **Ventas por revisar:** capturas manuales pendientes de todas las fechas.
- **Empleados:** agregar, editar, eliminar/restaurar y consultar comisiones por
  día, semana, mes o rango personalizado. Liquidar un periodo o todas las pendientes
  del empleado, sin límite de mes.

Un selector reúne Hoy, Esta semana, Este mes y Rango personalizado; las flechas
consultan periodos anteriores y Volver a hoy recupera el día actual. Sólo el rango
personalizado solicita fecha inicial y final. Ganancia, Historial y Empleados
conservan sus propios periodos.
Los pagos se agrupan por empleado y las confirmaciones permanecen hasta cerrarlas.
Todos los apartados se abren en un clic desde la barra lateral o la cuadrícula móvil.
Cada uno conserva su dirección al recargar y admite Atrás/Adelante. Los enlaces
antiguos a `?seccion=resumen` abren Ganancia.

Fondo blanco, texto grande y controles accesibles. Los proveedores se recuerdan
al confirmar una salida y completan el concepto y el pago de capturas futuras.

## Registro manual y tickets únicos

Las ventas de los otros sistemas nunca se cargan ni suman automáticamente.
Escanear sólo prerrellena el formulario; el administrador debe guardar para
registrar. **Nueva venta** abre un formulario manual con producto/servicio,
cantidad, precio, forma de pago, cliente y comisión opcional (empleado e importe).
El servidor genera folio interno y fecha comercial; confirma el cobro completo.
Todos los campos y botones caben sin scroll en móvil y escritorio. Funciona aunque
la venta no exista en los otros sistemas; requiere que la base de Administración
esté disponible. **Escanear ticket** busca el documento existente y recupera
fecha, folio, cliente, teléfono, partidas,
subtotal, IVA, total y forma de pago. Sólo la confirmación crea el registro.
El detalle conserva los artículos, cantidades, precios unitarios, importes por
partida, subtotal, IVA y total; no cambia los importes del ticket de origen.

El servidor resuelve la identidad canónica y PostgreSQL exige UNIQUE(tabla, id).
La captura compacta genera `MAN-<UUID de la solicitud>` y conserva ese identificador
en reintentos simultáneos o posteriores; no pide el ID de otro sistema. Una venta
manual independiente no se vincula por coincidencias de cliente, producto o precio
con una venta externa: esos datos pueden coincidir en ventas legítimas distintas.
Los registros manuales anteriores que conservaron folio/origen e ID mantienen
sus comprobaciones frente a un escaneo posterior. Bloqueos transaccionales e
índices impiden repetir esos identificadores, incluso en guardados simultáneos.
Anular conserva los identificadores ocupados y el historial.

Las ventas manuales aparecen como **Requiere revisión**. `MAN-…` es una referencia
interna, no un folio validado. La pestaña **Revisión** reúne las pendientes de
cualquier fecha. La venta y su comisión quedan fuera de las ventas confirmadas
y de la ganancia hasta aprobar o validar. El importe por revisar aparece separado
para el periodo elegido; la cola mantiene todas las fechas. La comisión queda
congelada y fuera de cualquier liquidación.
El administrador puede aprobar la captura manual o buscar un folio/código y
confirmar **Validar y actualizar** después de revisar el ticket real. Sin
coincidencias no cambia el registro ni se libera la comisión.
La revisión muestra desde el inicio artículos, cantidades, precios, subtotal,
IVA, total, cliente, fecha, forma de pago y comisión. Los códigos y referencias
quedan disponibles dentro de «Datos del registro».

La validación actualiza únicamente el registro propio con fecha, cliente, forma
de pago, artículos, subtotal, IVA y total del ticket; conserva un cobro completo.
No crea otra venta ni modifica el documento externo. Mantiene el empleado y el
importe de comisión; si supera el nuevo total, exige ajustar el importe antes de
confirmar. Conserva auditoría de los valores anteriores y sus identificadores
para impedir duplicados posteriores. Un ticket modificado desde la revisión,
cancelado o ya usado por otra venta se rechaza. Una comisión pagada no se reabre
ni permite reescribir la venta mediante validación.

El código impreso incluye versión, tabla e ID:

```text
LLA1:V:<id>  # ventas: llantas y ventas mixtas
LLA1:P:<id>  # ventas_productos: módulo de productos negro
```

Los cambios de tickets están en `sistema-administracion` de ambos sistemas.
Reimprimir conserva el mismo código. El lector debe emular un teclado y terminar
con Enter o Tab. Se controla el foco, se admite el prefijo AIM `]C0` de CODE128
y nunca se confirma una venta mediante el fin del escaneo. Los tickets anteriores
pueden buscarse por folio o ID; si el folio es ambiguo, se debe usar la identidad
completa.

Las consultas externas se limitan a la búsqueda y validación explícita del ticket.
No se modifica stock, documentos de venta, folios, IVA histórico ni archivos
originales. Las cancelaciones de otra app no reescriben el resumen: se revisan y
anulan manualmente aquí. Nuevos abonos sobre un ticket cancelado se rechazan.

## Inicio local

Requiere Node.js 22.18+ y el PostgreSQL local preparado en `127.0.0.1:55439`.
La configuración local usa dos bases y credenciales diferentes:

| Conexión              | Base                                                            | Acceso                                      |
| --------------------- | --------------------------------------------------------------- | ------------------------------------------- |
| `DATABASE_URL`        | `llantas_administracion_dev`                                    | Escritura propia con `sistema_admin_writer` |
| `SHARED_DATABASE_URL` | `postgres` desplegada; `llantas_unified_dev` en pruebas locales | SELECT con credencial exclusiva de lectura  |

1. `npm ci`.
2. Conservar la configuración privada preparada en `.env.local`; `.env.example`
   documenta ambas conexiones y sus identidades.
3. Si la base está detenida, ejecutar `npm run dev:db` en `C:\dev\sistemaBodega`.
4. `npm run db:migrate`.
5. `npm run dev` y abrir [Administración](http://127.0.0.1:3002).

Para preparar esta separación por primera vez, `scripts/setup-storage.mjs` recibe
la conexión propietaria local de `llantas_unified_dev` mediante `DATABASE_URL`,
`SHARED_DATABASE_ENVIRONMENT=development` y su `SHARED_DATABASE_ID`. Se ejecuta con
`node --env-file=.env.local scripts/setup-storage.mjs` antes de iniciar la app.
La instancia anterior de Administración debe estar detenida durante el traslado.
Crea la base y los roles propios, copia el historial previo de Administración
desde una instantánea de lectura, sin borrar el original, y reemplaza `.env.local`
por las conexiones limitadas.
Guarda el estado, respaldo y conexión de mantenimiento sólo en `.local/`, fuera
de Git. Rechaza bases o roles de destino desconocidos; las siguientes ejecuciones
usan su estado privado. Este preparador sólo admite la instancia local indicada.

El servidor escucha en loopback. Las APIs no requieren login; las escrituras
validan el origen de la petición. El pool comprueba versión, entorno, nombre e
identidad de cada base antes de operar. La conexión de origen tiene SELECT y
transacciones de sólo lectura; la app no escribe en la base compartida.
Desarrollo rechaza la escritura en una base propia productiva.
La lectura operativa de tickets desplegados permite un origen `production` con
`SHARED_DATABASE_ALLOW_PRODUCTION_READS=true`. Cada conexión verifica que el usuario
sólo tenga SELECT, sin propiedad ni permisos de escritura o creación. La base
propia mantiene su conexión independiente. Las pruebas nunca admiten producción.
`scripts/configure-production-source.mjs` prepara únicamente la credencial lectora
del destino fijado mediante `--connection-file`, `--instance` y `--cluster`, verifica
sus permisos y guarda la conexión en `.env.local`. No modifica registros de venta,
existencias, folios ni el esquema de las apps desplegadas. Los secretos quedan en
`.local/`; el perfil previo se conserva en `.local/development.env` para ejecutar
las pruebas de integración con las dos bases locales.
Las variables privadas, respaldos y datos de QA quedan fuera de Git.

## Cifras y persistencia

Ganancia = ventas confirmadas − salidas − comisiones de ventas confirmadas en el período.
La tarjeta Total de ventas usa sólo entradas aprobadas o validadas del mismo periodo.
Las ventas por revisar y sus comisiones se muestran aparte; al aprobarlas entran
en la fecha original, y al validarlas se utiliza la fecha y los importes del ticket.
Los gastos y las comisiones de ventas confirmadas se descuentan aunque estén pendientes de pago;
liquidarlos después no vuelve a descontarlos. Las anulaciones quedan fuera.
Las ventas se registran con cobro completo al momento; no hay ventas a crédito
ni abonos de clientes. Los saldos pendientes de proveedores abarcan todas las fechas.
Las comisiones por pagar sólo incluyen las liberadas; las congeladas se separan.
Los pagos parciales de salidas se ligan al gasto original y no crean otra compra.
Los importes usan centavos.
Las fechas comerciales corresponden a Ciudad de México; las semanas comienzan
el lunes. No se inventan costos de inventario ni se calcula utilidad fiscal.

Cada entrada tiene una sola comisión opcional y un único empleado, asignados
antes de confirmar la venta. El dueño captura el importe manualmente: debe ser
mayor a cero y no superar el total de la venta. No hay porcentajes sugeridos ni
preferencias guardables.
Dar de baja al empleado conserva su historial y permite pagar deudas anteriores.
La liquidación agrupa únicamente las comisiones pendientes revisadas por empleado
y periodo, o todas las pendientes de cualquier fecha. Guarda un comprobante
interno y se confirma de forma atómica: si otro pago se adelanta, se rechaza el
grupo y se pide actualizar. Un trigger
impide modificar o reabrir una comisión pagada. Los reintentos devuelven el mismo pago.
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

La integración crea dos clones en `127.0.0.1:55439`: `llantas_admin_tests`
(Administración) y `llantas_admin_source_tests` (origen). Usa la conexión privada
de mantenimiento generada por el preparador para crearlos y eliminarlos, y
comprueba que el lector de origen rechace escrituras. Si cualquiera ya existe,
se detiene sin sobrescribirlo. Los fixtures sólo se crean en los clones.
`npm run test:integration -- --keep` retiene ambos para QA y escribe
`.local/test.env`, ignorado por Git.
Las pruebas del contrato de impresión se ejecutan con `npm run test:ticket-barcodes`
en ambos repositorios de ventas: un decodificador independiente lee las imágenes
CODE128 renderizadas a 203 y 300 dpi. La impresora y el lector físicos deben probarse
con un ticket real antes del uso operativo.

Las migraciones se aplican en una transacción, sólo en la base propia.
No se aplicaron a producción ni se desplegó la aplicación. El código de la app
nunca ejecuta migraciones desde una petición.

Configuración del lector y comprobación física: [guía de tickets](docs/scanner.md).
