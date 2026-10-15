# Interfaz

El administrador revisa tickets de empleados, registra ventas y gastos y liquida
comisiones. La pantalla debe sentirse como una mesa de control: cifras legibles,
folios verificables y acciones claras. Tres secciones, sin login ni gráficas.

Papel blanco puro, azul de carpeta administrativa (#182d48), verde de entrada
(#08775f), cobre de salida e índigo de comisiones. El color distingue el destino
del dinero. Acciones grandes de Registro, captura de ticket en una franja azul y
corte de comisiones en índigo con los folios a pagar. Sin degradados ni dibujos.

Segoe UI, base 18px, títulos de 30–34px, cifras tabulares, controles de al menos
52px y espacios en múltiplos de 4px. Bordes definidos y estados de cobro explícitos.

Nueva venta es una hoja compacta: producto, cantidad/precio, forma de pago/cliente,
comisión opcional con empleado/importe y total. Folio y fecha automáticos. No hay
scroll ni pasos: el título, todos los campos y los botones permanecen dentro del
viewport. En horizontal bajo, producto/precio/cliente ocupan la izquierda y
comisión/total la derecha. El espaciado se compacta según la altura disponible.
El resto de formularios mantiene título y confirmación fijos al desplazar el cuerpo.
Escanear ticket identifica y prerrellena; ambos flujos requieren confirmación.

Revisión visual de la venta manual: 1366×768, 375×667, 320×568, 390×844, 844×390 y
568×320 con la comisión activada; también importes largos y errores de validación.
Tablas y pestañas desplazan su propio contenedor. El resumen sólo usa registros propios.
