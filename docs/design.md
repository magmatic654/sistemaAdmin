# Interfaz

El administrador revisa tickets de empleados, registra ventas y gastos y liquida
comisiones. La pantalla debe sentirse como una mesa de control: cifras legibles,
folios verificables y acciones claras. Cinco destinos directos: Registro, Ganancia,
Pagos pendientes, Historial y Empleados. Sin login ni gráficas.
La barra lateral de escritorio y la cuadrícula móvil muestran todos los destinos;
no hay selector Ver ni menús para buscar cada tarea. Las direcciones permiten
recargar, compartir un apartado y usar Atrás/Adelante. Resumen conserva un alias a Ganancia.

Papel blanco puro, texto oscuro y bordes grises. Los textos de ventas/ganancia positiva
usan verde y los de gastos/comisiones/pérdidas usan rojo dentro del cálculo. Los importes cero quedan neutros. Errores y acciones destructivas
conservan rojo. No hay símbolos de cálculo, fondos de color, degradados ni dibujos.

Segoe UI, base 18px, títulos de 30–34px, cifras tabulares, controles de al menos
52px y espacios en múltiplos de 4px. Bordes definidos y estados de cobro explícitos.

Nueva venta es una hoja compacta: folio/producto, cantidad/precio, forma de pago/cliente,
comisión opcional con empleado/importe y total. Folio obligatorio y fecha comercial automática. No hay
scroll ni pasos: el título, todos los campos y los botones permanecen dentro del
viewport. En horizontal bajo, producto/precio/cliente ocupan la izquierda y
comisión/total la derecha. El espaciado se compacta según la altura disponible.
El resto de formularios mantiene título y confirmación fijos al desplazar el cuerpo.
Escanear ticket identifica y prerrellena; ambos flujos requieren confirmación.
La comisión se captura como importe manual junto a la venta y nunca supera su
total. No hay ajustes ni sugerencias de porcentaje.

Un selector ofrece Hoy, Esta semana, Este mes y Rango personalizado. Los tres primeros
muestran el intervalo con flechas y Volver a hoy; sólo el personalizado despliega
Desde/Hasta. Liquidar comisiones abre Todas las pendientes, con todas las fechas,
y permite acotar el periodo antes de confirmar. Las pagadas quedan fuera del pago.

Ganancia destaca su cifra en una tarjeta grande blanca a la izquierda.
A su derecha, tres tarjetas pequeñas blancas apiladas
explican el resultado: ventas, gastos y comisiones confirmadas.
En móvil, la ganancia aparece primero y sus detalles debajo. Pagos pendientes
es un espacio separado que reúne los saldos globales de proveedores y empleados,
con selector del destinatario y acceso a sus pendientes. Historial muestra sólo
los registros elegidos. Ganancia, Historial y Empleados conservan periodos propios;
Pagos no tiene filtro de fecha.
Nueva venta exige el folio del ticket y confirma al guardar, sin aprobación posterior.
La comisión queda disponible para liquidar desde el registro. No existe apartado de
revisión ni una franja adicional en Ganancia. Las capturas históricas pendientes
sólo muestran «Sin folio» en Historial; su detalle ofrece «Completar folio».
Completarlo conserva sus importes y fecha original; hasta entonces, venta y comisión
permanecen fuera de la ganancia y los pagos. Los registros ya confirmados conservan
su estado. Los códigos y referencias técnicas quedan plegados en «Datos del registro».

Las ventas se registran con cobro completo, sin apartado de crédito ni abonos de
clientes. Los pagos parciales y saldos pendientes sólo corresponden a proveedores.
El detalle de cada venta muestra artículos,
cantidad, precio unitario, importe por partida, subtotal, IVA y total en fichas
que se adaptan al ancho de escritorio y móvil.

Revisión visual de la venta manual: 1366×768, 375×667, 320×568, 390×844, 844×390 y
568×320 con la comisión activada; también importes largos y errores de validación.
Los accesos se distribuyen en dos filas en móvil. Hasta 1000px, las tablas se presentan
como fichas con etiquetas y todas sus acciones; en escritorio ajustan sus columnas.
Folios, nombres y referencias largas se parten dentro de su espacio. Ninguna vista,
menú o formulario requiere desplazamiento horizontal. Se conserva sólo el eje Y,
excepto la venta manual compacta, que sigue cabiendo completa sin scroll.
Revisión de ancho: 320, 360, 390, 568, 768, 820, 1000, 1024 y 1280px, incluidos
registros con nombres/folios sin espacios e importes máximos, menús y calendarios.
El resumen sólo usa registros
de la base propia de Administración. La base compartida queda de sólo lectura
para identificar tickets solicitados explícitamente.
