# Bitácora del proyecto WMS

Registro corto del avance trabajado con Claude. Se lee al empezar cada sesión y se
actualiza al cerrar cada bloque de trabajo (junto con el commit). Lo detallado vive en
`docs/PROJECT_CHANGELOG.md` y `docs/bitacora-pruebas-manuales-2026-09.md`.

## Estado actual (2026-10-13)

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

1. **Códigos SIIGO ≠ SKU del WMS.** Las facturas usan códigos de SIIGO/Shopify
   (`7709771394853XX1`, `S00974`, `127` plan 2 tarros, `env-1` envío…) que nunca han tenido
   lotes; el inventario está en los SKU internos (`00102-PTASH60`…). Falta tabla de
   equivalencias código SIIGO → SKU WMS con factor (X2, planes/combos) validada por el cliente.
2. **Clientes no sincronizados** (24/24): el despacho queda en borrador sin reservar y nada
   lo reintenta. Traer el cliente desde SIIGO al importar.
3. **La importación trae 0 facturas**: usa `updated_start`, que SIIGO ignora (ya visto en
   julio). Cambiar a consulta por fecha como el simulador. Hacerlo después de 1 y 2.
4. Ignorar líneas de envío/servicio en la importación.
5. La revisión de cambios de facturas pendientes solo toma 20 despachos por corrida.
6. Alertas de factura cambiada después de despachar: sin pantalla.
7. Reporte stock WMS vs SIIGO (Etapa 1).
8. Guía operativa v2 (frases cambiadas: «confirmo cierre OP ID n», «Revisa materiales OP ID n»).
9. Hallazgos menores: cuarentena en misma ubicación que disponible; lote interno de
   cuarentena ilegible; lote demo `DEMO-MAPA-*` como disponible; artículos de suscripción
   en el catálogo; renovar token de sesión del dashboard (hoy cierra a las 8 h).
10. Limpieza de pruebas del 07/10: OC 64 quedó con proveedor equivocado (3Q demo en vez
    del NIT del PDF; anular, no se puede editar) y borradores de OC por PDF 84–95 sin descartar.
11. Probar la lectura con IA con un PDF real de OC emitida en SIIGO (solo hay PDFs de prueba).

## Registro (más reciente primero)

### 2026-10-13
- Manual de pruebas SIIGO–WMS (doc en Claude Docs).
- Simulador de facturas reales SIIGO (solo lectura) en Despachos > Novedades SIIGO.
  Resultado: 24 facturas, 0 pasarían → Pendientes 1–3.

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
