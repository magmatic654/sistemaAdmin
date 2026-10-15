# Reglas del proyecto

- Mantener sólo tres secciones principales: Registro, Resumen y Empleados.
- No implementar inicio de sesión mientras el propietario no lo solicite.
- Fondo blanco, letra grande, acentos de color con intención y mínimo texto. No agregar gráficas.
- Ninguna vista ni formulario debe generar desplazamiento horizontal, tampoco
  dentro de tablas o paneles. Adaptar el contenido al ancho; sólo se permite scroll Y.
- Todo registro financiero requiere confirmación manual. No importar ni mostrar
  ventas de las otras apps sin una búsqueda explícita de ticket.
- Una venta sólo puede registrarse una vez por su identidad canónica (tabla, id).
- Nueva venta abre captura manual con folio y fecha automáticos, aunque no exista en los otros sistemas.
  Escanear ticket busca y prerrellena. Nunca unir esos dos flujos.
- El formulario manual sólo muestra producto/servicio, cantidad, precio, forma de
  pago, cliente y comisión opcional (empleado e importe). Todo debe caber sin scroll
  en escritorio y móvil; distribuir en columnas para pantallas horizontales bajas.
- Comprobar folio/origen e ID disponible para impedir duplicados entre captura
  manual y escaneo. La comisión se asigna junto con la venta, nunca después.
- Toda venta manual sin ticket validado requiere revisión. Su referencia interna
  no es un folio de origen. Congelar su comisión hasta aprobación manual explícita
  o validación de ticket; aplicar esta regla también en pagos individuales y lotes.
- Las ventas por revisar y sus comisiones no entran en ventas confirmadas ni en
  la ganancia. Mostrar su importe aparte por periodo y distinguirlo de la cola
  global. Las comisiones por pagar sólo incluyen ventas aprobadas o validadas.
- Mostrar producto, cantidad, precios, cliente, fecha, pago y comisión antes de
  pedir una decisión de revisión. Dejar códigos y referencias internas en un
  desplegable secundario; no usarlos como nombre de una venta en las listas.
- Validar un ticket requiere mostrar los datos reales y confirmar su actualización
  en Administración. Conservar auditoría y alias anteriores para evitar duplicados;
  una búsqueda sin coincidencias no aprueba ni altera la venta. No reescribir
  registros con comisiones ya pagadas.
- Capturar la comisión como importe manual mayor a cero y hasta el total de la venta;
  no implementar porcentajes sugeridos ni preferencias de comisión.
- Consultar por día, semana, mes o rango personalizado. Sólo el rango personalizado
  muestra fechas editables; los periodos estándar usan flechas y un intervalo legible.
- Liquidar las pendientes revisadas por empleado y periodo, o todas las pendientes
  de cualquier fecha. Una comisión pagada no se reabre ni se cobra otra vez.
- Mostrar las partidas de cada venta con cantidad, precio unitario, importe,
  subtotal, IVA y total. Conservar los importes históricos del ticket.
- Las ventas se registran con cobro completo al momento. No implementar ventas
  a crédito, saldos de clientes ni abonos a entradas. Los pagos parciales y pendientes
  corresponden exclusivamente a salidas/proveedores.
- Guardar todos los registros propios en una base independiente de Administración.
  La conexión compartida sólo tiene SELECT y se consulta al buscar o validar un ticket
  explícitamente; nunca escribir, migrar ni eliminar datos desde esa conexión.
- Preservar los controles de identidad de ambas bases y los registros históricos.
- Ejecutar integración únicamente sobre los dos clones desechables de Administración
  y origen. No crear fixtures en las bases de desarrollo.
- No usar producción para desarrollar o probar. La lectura operativa de tickets
desplegados está autorizada con usuario SELECT exclusivo e identidad verificada;
requiere SHARED_DATABASE_ALLOW_PRODUCTION_READS=true en el servidor local.
Las pruebas y fixtures usan exclusivamente el perfil privado de desarrollo y clones.
No guardar secretos en Git.
<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
