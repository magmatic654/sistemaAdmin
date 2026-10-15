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
La comisión se captura como importe manual junto a la venta y nunca supera su
total. No hay ajustes ni sugerencias de porcentaje.

Los filtros ofrecen Día, Semana, Mes y Rango personalizado. Los tres primeros
muestran el intervalo con flechas para navegar; sólo el personalizado despliega
Desde/Hasta. Liquidar comisiones abre Todas las pendientes, con todas las fechas,
y permite acotar el periodo antes de confirmar. Las pagadas quedan fuera del pago.

Las ventas se registran con cobro completo, sin apartado de crédito ni abonos de
clientes. Los pagos parciales y saldos pendientes sólo corresponden a proveedores.
El detalle de cada venta muestra artículos,
cantidad, precio unitario, importe por partida, subtotal, IVA y total en fichas
que se adaptan al ancho de escritorio y móvil.

Revisión visual de la venta manual: 1366×768, 375×667, 320×568, 390×844, 844×390 y
568×320 con la comisión activada; también importes largos y errores de validación.
Las pestañas se distribuyen en varias filas. Hasta 1000px, las tablas se presentan
como fichas con etiquetas y todas sus acciones; en escritorio ajustan sus columnas.
Folios, nombres y referencias largas se parten dentro de su espacio. Ninguna vista,
menú o formulario requiere desplazamiento horizontal. Se conserva sólo el eje Y,
excepto la venta manual compacta, que sigue cabiendo completa sin scroll.
Revisión de ancho: 320, 360, 390, 568, 768, 820, 1000, 1024 y 1280px, incluidos
registros con nombres/folios sin espacios e importes máximos, menús y calendarios.
El resumen sólo usa registros
de la base propia de Administración. La base compartida queda de sólo lectura
para identificar tickets solicitados explícitamente.
