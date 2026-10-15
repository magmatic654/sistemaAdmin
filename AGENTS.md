# Reglas del proyecto

- Ofrecer accesos directos visibles a Registro, Ganancia, Pagos pendientes,
  Historial y Empleados. No agruparlos bajo Resumen ni un selector Ver.
  Cada espacio tiene su URL; conservar ?seccion=resumen como alias de Ganancia
  y ?seccion=revision como alias de Historial.
- No implementar inicio de sesión mientras el propietario no lo solicite.
- Fondo blanco, letra grande y mínimo texto. En el desglose de ganancia, usar sólo
  texto verde para ventas/ganancia positiva y rojo para gastos/comisiones/pérdida.
  Los importes cero quedan neutros. No agregar
  gráficas, fondos de color ni indicadores de cálculo (+, −, =) a las tarjetas.
  Reservar también el rojo para errores/acciones destructivas.
- Ninguna vista ni formulario debe generar desplazamiento horizontal, tampoco
  dentro de tablas o paneles. Adaptar el contenido al ancho; sólo se permite scroll Y.
- Todo registro financiero requiere confirmación manual. No importar ni mostrar
  ventas de las otras apps sin una búsqueda explícita de ticket.
- Una venta sólo puede registrarse una vez por su identidad canónica (tabla, id).
- Nueva venta exige el folio real del ticket y asigna la fecha comercial actual,
  aunque no exista en los otros sistemas. Guardar confirma la venta y su comisión.
  Escanear ticket busca y prerrellena. Nunca unir esos dos flujos.
- El formulario manual sólo muestra folio, producto/servicio, cantidad, precio, forma de
  pago, cliente y comisión opcional (empleado e importe). Todo debe caber sin scroll
  en escritorio y móvil; distribuir en columnas para pantallas horizontales bajas.
- Comprobar folio/origen e ID disponible para impedir duplicados entre captura
  manual y escaneo. La comisión se asigna junto con la venta, nunca después.
- No implementar aprobación, validación posterior ni un apartado de revisión de ventas.
  Los registros históricos pendientes sin folio se conservan en Historial como
  «Sin folio»: completar el folio confirma la captura sin alterar importes, fecha,
  artículos o pagos. Hasta completarlo, no afectan ventas, ganancia ni pagos de comisiones.
  No confirmar automáticamente registros antiguos ni reabrir comisiones pagadas.
- En Ganancia, destacar la cifra grande y agrupar ventas, gastos y comisiones como
  detalles pequeños a su lado; en móvil, ganancia primero y detalles debajo.
- Mostrar una tarea a la vez, accesible en un clic desde la navegación. En escritorio
  usar una barra lateral y en móvil una cuadrícula de accesos visibles sin scroll X.
  Pagos abarca todas las fechas sin filtros de periodo.
  Ganancia, Historial y Empleados conservan periodos independientes. Agrupar pagos
  de comisiones por empleado. Admitir enlaces directos, recarga y Atrás/Adelante.
- Usar un único selector de periodo con flechas cercanas y Volver a hoy para consultas
  históricas. Al elegir Hoy/Esta semana/Este mes, partir de la fecha comercial actual.
  Mantener navegación con áreas de 48 × 48 px y acciones principales de al menos 48 px de alto;
  no reducir letra o botones para compactar la cabecera móvil.
- Confirmar guardados y pagos con importe/destinatario cuando corresponda. El aviso
  permanece en el flujo de la página hasta cerrarlo; no tapar botones con avisos flotantes.
- Mostrar producto, cantidad, precios, cliente, fecha, pago y comisión en el detalle.
  Dejar códigos y referencias internas en un desplegable secundario.
- Conservar auditoría y alias anteriores al completar folios históricos para impedir
  duplicados. Nunca reescribir una venta con comisión ya pagada.
- Capturar la comisión como importe manual mayor a cero y hasta el total de la venta;
  no implementar porcentajes sugeridos ni preferencias de comisión.
- Consultar por día, semana, mes o rango personalizado. Sólo el rango personalizado
  muestra fechas editables; los periodos estándar usan flechas y un intervalo legible.
- Liquidar las pendientes con folio por empleado y periodo, o todas las pendientes
  de cualquier fecha. Una comisión pagada no se reabre ni se cobra otra vez.
- Mostrar las partidas de cada venta con cantidad, precio unitario, importe,
  subtotal, IVA y total. Conservar los importes históricos del ticket.
- Las ventas se registran con cobro completo al momento. No implementar ventas
  a crédito, saldos de clientes ni abonos a entradas. Los pagos parciales y pendientes
  corresponden exclusivamente a salidas/proveedores.
- Guardar todos los registros propios en una base independiente de Administración.
  La conexión compartida sólo tiene SELECT y se consulta al buscar un ticket
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
