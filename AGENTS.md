# Reglas del proyecto

- Mantener sólo tres secciones principales: Registro, Resumen y Empleados.
- No implementar inicio de sesión mientras el propietario no lo solicite.
- Interfaz blanca, letra grande y mínimo texto. No agregar gráficas.
- Todo registro financiero requiere confirmación manual. No importar ni mostrar
  ventas de las otras apps sin una búsqueda explícita de ticket.
- Una venta sólo puede registrarse una vez por su identidad canónica (tabla, id).
- Preservar la base compartida, sus controles de identidad y los registros históricos.
- No usar producción para desarrollar o probar. No guardar secretos en Git.
<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
