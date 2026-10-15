# Tickets y lectores

## Captura manual

Nueva venta no consulta ventas de las otras apps. Requiere folio y partidas;
cliente, teléfono e ID completo impreso son opcionales. Elegir negro o blanco
si se conoce el origen; Sin sistema reserva ese folio frente a ambos. La venta
y su comisión se guardan juntas, aunque no exista un documento externo.

El folio debe conservarse tal como aparece en el papel. El sistema evita repetir
folio/origen e ID disponible, incluido un escaneo posterior. Un ticket manual
sin ID no puede reconocerse si se le inventa otro folio. Anular no libera los
identificadores para registrar otra vez el mismo ticket.

## Escaneo

Los tickets de ambos repositorios imprimen CODE128 con identidad estable:
`LLA1:V:<id>` para ventas mixtas/llantas, `LLA1:P:<id>` para productos del sistema
negro. El ID lo crea la app de ventas; el folio se recupera de ese documento,
no se genera al escanear. Las reimpresiones conservan ambos. Los tickets antiguos
se pueden buscar por folio; si coinciden varios se elige el origen y la fecha.

El código sólo contiene identidad. Tras una búsqueda explícita, Administración
recupera el documento de la misma base y muestra sus datos para revisión. Nunca
se añade al resumen hasta confirmar. Una venta previamente registrada o
capturada manualmente se bloquea. No hay sincronización automática de ventas.

## Configuración del equipo

USB y Bluetooth describen la conexión; el modo del lector debe ser **HID/teclado**.
En este modo escribe en el campo enfocado como un teclado. No necesita WebUSB,
permisos de cámara ni drivers dentro de la aplicación. Un equipo configurado
como puerto serial/COM requiere otra integración o cambiarlo a HID.

1. Habilitar CODE128 y modo teclado en el manual del lector.
2. Ajustar el país/idioma del lector al teclado de Windows; comprobar `:`, guion,
   números y mayúsculas. No forzar conversión de mayúsculas o minúsculas.
3. Configurar sufijo Enter/CR o Tab. Se admite prefijo AIM `]C0`; desactivar otros
   prefijos personalizados. Sin sufijo, pulsar Buscar ticket después de escanear.
4. Abrir Escanear ticket y comprobar Listo para escanear. Si el campo perdió
   el foco, pulsar Activar. El estado indica foco, no una conexión detectada.
5. Escanear y revisar folio, fecha, cliente, partidas e importes; elegir comisión
   y empleado; pulsar Confirmar venta. El sufijo nunca guarda la venta.

No se arreglan ni adivinan IDs mal leídos. El ingreso rápido y los sufijos Enter
y Tab fueron simulados en navegador; un decoder independiente verificó imágenes
de los dos tipos de código a 203/300 dpi. Esto no sustituye el ensayo físico.

Antes de usarlo en caja: imprimir un ticket de prueba de cada sistema al tamaño
real de papel de 80mm, sin encoger para ajustar, leerlo con el equipo elegido,
comparar el ID con el impreso y repetir la lectura tras guardar para comprobar
el bloqueo de duplicados. Usar una copia de pruebas, no ventas reales para QA.

Fuentes de fabricantes:

- [Zebra: interfaces USB y modo HID](https://docs.zebra.com/us/en/scanners/general/ds4-series/ds4678-prg/getting-started/interfaces.html).
- [Zebra: país del teclado](https://docs.zebra.com/us/en/scanners/general/ds4-series/ds4678-prg/country-codes/usb-and-keyboard-wedge-country-keyboard-types-%28country-codes%29.html).
- [Zebra: sufijo Enter al terminar un escaneo](https://support.zebra.com/article/000011457).
- [Honeywell: guía del lector HF52X](https://prod-edam.honeywell.com/content/dam/honeywell-edam/sps/siot/en-gb/products/barcode-scan-engines-modules-and-decoding-software/barcode-scan-modules/hf521-2d-imager-module/documents/sps-siot-optical-sensing-hf52x-2d-imager-module-user-guide-en.pdf).
