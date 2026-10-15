# Reglas del proyecto

- Mantener sólo tres secciones principales: Registro, Resumen y Empleados.
- No implementar inicio de sesión mientras el propietario no lo solicite.
- Fondo blanco, letra grande, acentos de color con intención y mínimo texto. No agregar gráficas.
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
- Liquidar comisiones por empleado y día/semana/mes, sólo las pendientes revisadas.
- Preservar la base compartida, sus controles de identidad y los registros históricos.
- No usar producción para desarrollar o probar. No guardar secretos en Git.
<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
