# Bitácora del proyecto WMS

Registro corto del avance trabajado con Claude. Se lee al empezar cada sesión y se
actualiza al cerrar cada bloque de trabajo (junto con el commit). Lo detallado vive en
`docs/PROJECT_CHANGELOG.md` y `docs/bitacora-pruebas-manuales-2026-09.md`.

## Estado actual (2026-10-13)

- Prueba de publicación GitHub → Vercel iniciada el 03/11 con un cambio cosmético en el pie del menú.
- En producción (`wms-seven-ebon.vercel.app`) desde el 05/10. Agente WhatsApp operativo.
- **Integración SIIGO de ventas: NO está pasando ninguna factura real al WMS.** El
  simulador (Despachos > Novedades SIIGO) encontró 24 facturas del 05 al 13/10: 0
  importadas, 0 pasarían. Tres causas (ver Pendientes 1–3).
- Compras: OC por PDF (web y WhatsApp) probadas y ajustadas el 07/10; recepción guiada OK.
- Producción (liberar, alistar, cerrar con reposición) probada por WhatsApp el 05 y 08/10.

## Decisiones vigentes

- Cliente (30/09 y 02/10): bodega única Infinity; todas las facturas salen de ahí; el WMS
  manda en inventario y **solo lee** SIIGO; compras nacen de la OC (PDF), no de la factura
  de compra; ventas desde 2026-10-05; la clienta corrige desde su usuario las facturas
  que no pasan. Reporte de stock WMS vs SIIGO (Etapa 1) aceptado, sin frecuencia ni
  destinatario definidos.
- Rol `recepcion_cierre` no crea OC (solo admin/supervisor).
- Confirmar materiales en dashboard exige revisar y marcar cada partida.
- Webhooks SIIGO de facturas, compras y notas crédito desactivados (410): la importación
  es por consulta cada 2 minutos.
- No hacer facturas de prueba en SIIGO: la cuenta es real y cada factura va a la DIAN.
  Validar con el simulador (solo lectura).

## Pendientes (en orden)

0. Confirmar que el cambio cosmético de prueba llega a `main` y aparece en el despliegue de Vercel.
1. **Códigos SIIGO ≠ SKU del WMS.** Las facturas usan códigos de SIIGO/Shopify
   (`7709771394853XX1`, `S00974`, `127` plan 2 tarros, `env-1` envío…) que nunca han tenido
   lotes; el inventario está en los SKU internos (`00102-PTASH60`…). Falta tabla de
   equivalencias código SIIGO → SKU WMS con factor (X2, planes/combos) validada por el cliente.
   Borrador enviado a validar el 13/10 (20 códigos: 16 con SKU propuesto, planes 127/128/129
   por definir, `env-1` ignorar). Además, casi todos los PT del WMS tienen stock 0: falta
   cargar inventario inicial de producto terminado o las facturas quedarán PENDIENTE_STOCK.
2. **La importación trae 0 facturas**: usa `updated_start`, que SIIGO ignora. Corrección
   lista en la rama `siigo-importacion-por-fecha` (consulta por fecha de factura, salta las ya
   importadas). **Fusionar a main solo cuando 1 esté validado**: al activarla entran de golpe
   las ventas desde el 05/10.
3. Ignorar líneas de envío/servicio en la importación.
4. La revisión de cambios de facturas pendientes solo toma 20 despachos por corrida.
5. Alertas de factura cambiada después de despachar: sin pantalla.
6. Reporte stock WMS vs SIIGO (Etapa 1).
7. Guía operativa v2 (frases cambiadas: «confirmo cierre OP ID n», «Revisa materiales OP ID n»).
8. Hallazgos menores: cuarentena en misma ubicación que disponible; lote interno de
   cuarentena ilegible; lote demo `DEMO-MAPA-*` como disponible; artículos de suscripción
   en el catálogo; renovar token de sesión del dashboard (hoy cierra a las 8 h).
9. Limpieza de pruebas del 07/10: OC 64 quedó con proveedor equivocado (3Q demo en vez
    del NIT del PDF; anular, no se puede editar) y borradores de OC por PDF 84–95 sin descartar.
10. OC real de SIIGO (OC-1-354, Alnature, 05/11): no trae código, solo descripción. Ya se
    asigna SKU por descripción con aviso «confírmalo»; validar con Rosa qué SKU es «GOMA DE
    GELATINA - CREATINA, FOS Y PROBIOTICOS» (¿00052-MPCG Creagums o 00050-MPRO Probióticos?).

## Registro (más reciente primero)

### 2026-11-05
- Prueba con Rosa: la OC real de SIIGO (OC-1-354) quedaba sin ítems porque SIIGO no imprime
  código de producto. La lectura con IA recibe el catálogo y propone el SKU por descripción
  con advertencia para confirmar; las filas sin coincidencia se avisan en vez de perderse.
- Segundo intento: «requiere número visible». El encabezado de SIIGO («No. OC-1-354»,
  «Fecha», dos «Nit» entrelazados) ahora se lee sin IA; el proveedor sale de terceros por
  NIT. Groq se reintenta una vez si falla (sin acceso a logs de Vercel: 403).
- Tercer intento: «al menos un ítem». La IA debe elegir siempre el SKU más probable y listar
  alternativas en el aviso; el error sin ítems ahora muestra el motivo.
- Manual de validación para la persona de SIIGO (Claude Docs): parte A de lectura, posible hoy;
  parte B venta→despacho, tras activar la integración.
- Rosa aclaró `527667` (FE 17775, PriceSmart): fueron 4.536 tarros de Ashwagandha x120 →
  `00200-PTASH120`, factor 1. Verifica si Ashwagandha x60 y Calm Vibes x60 comparten código.
- Siguen sin respuesta: `2835000921`, planes 127/128/129, `28350010101`, conteo y fecha de inicio.

### 2026-11-03
- Se preparó una prueba de publicación con un cambio solo tipográfico en el pie del menú lateral; no altera flujos ni inventario.
- Se verificará el commit en `main` y la publicación de Vercel antes de continuar con ajustes funcionales.

### 2026-10-29
- Guía de pruebas SIIGO con contabilidad (`docs/WMS_Guia_Pruebas_SIIGO_Contabilidad_2026-10-29.pdf`):
  5 pruebas posibles hoy (lectura de ventas con el simulador, validar equivalencias,
  productos, OC en PDF de SIIGO, stock WMS vs SIIGO) y fase 2 venta→despacho con requisitos.
- Equivalencias SIIGO→SKU siguen sin respuesta del cliente (el Excel volvió vacío el 16/10).

### 2026-10-20
- Formato enviado a la persona de Sysplus (según el usuario; pendiente su respuesta).
- Revisión de la bitácora: faltaban los commits del 14–16/10 (abajo). La sesión de Juan
  no está aplicando la regla de `CLAUDE.md`.

### 2026-10-14 / 16 (Juan)
- Embalaje separado en despachos SIIGO y 3Q: el operario declara cajas y tapas de caja
  máster al confirmar; se descuentan por lote (`database/42_dispatch_packaging.sql`,
  migración manual `scripts/apply-dispatch-packaging-migration.js`; sin confirmar si ya
  se aplicó en producción). Sin declarar embalaje, el despacho funciona como antes.
- Cierre de OP: «0 no conformes» y listas de materiales por nombre.
- Recepción guiada: afirmaciones naturales al revisar SKU.
- Webhook BuilderBot: usa el mensaje actual cuando BuilderBot repite texto con hora.

### 2026-10-13
- Manual de pruebas SIIGO–WMS (doc en Claude Docs).
- Simulador de facturas reales SIIGO (solo lectura) en Despachos > Novedades SIIGO.
  Resultado: 24 facturas, 0 pasarían → Pendientes 1–3.
- Borrador de equivalencias SIIGO→SKU (Excel) para validación del cliente; hallado stock 0
  en casi todos los PT del WMS.
- Clientes faltantes: la importación los trae de SIIGO al vuelo y reintenta los despachos en
  borrador (en main). Consulta por fecha en rama aparte, pendiente de fusionar.

### 2026-10-07 / 08 (otra sesión, Juan y royandi200)
- PDF de OC por web: proveedor debe coincidir con el NIT, filas con códigos numéricos,
  advertencia por SKU fuera de catálogo, lectura con IA (Groq) + verificación nativa.
- Cierre de OP y alistamiento: muchas correcciones en lenguaje natural y voz.

### 2026-10-05
- Revisión de código + pruebas WhatsApp R1–R3, P2, B1 (OK). Corregidos: «7» suelto al
  elegir lote, «tapas sacadas del lote X» en cierre, «1 liner del lote X» en merma.
- Recepción no crea OC; revisión obligatoria de partidas en dashboard.
- Autocompletado y tablas ordenables en el dashboard; favicon y manifiesto.
- Carga de PDF de OC en la web (mismo lector que WhatsApp).
- Webhooks SIIGO inseguros desactivados (auditoría F-01).
- Novedades SIIGO: fallos de importación visibles y corregibles; el cursor ya no se
  congela por una factura.
- Usuario de pruebas «QA Pruebas» (573142365266) creado en producción.
