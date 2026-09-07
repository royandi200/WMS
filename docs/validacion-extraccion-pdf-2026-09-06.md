# Paquete 2: extraccion documental

Estado: implementacion y pruebas locales aprobadas; falta validacion real por WhatsApp,
dashboard y SQL. No cerrar RI-010/RI-011 solo por los tests. Base: `10c554a`.

## Diagnostico comprobado

- R12 OC, sin conteo ni total impreso: once filas completas extraibles desde el PDF
  nativo. JSON compacto conforme al contrato: 1168 caracteres. El limite anterior
  de 1700 NO demuestra la causa de aquel rechazo. Se elimina como restriccion
  artificial, no como afirmacion de haber identificado una limitacion del proveedor.
- El prompt permitia responder MODO_CHARLA literalmente, aunque el enrutamiento
  exige un JSON con `kw: g0m@s`. Todos los rechazos ahora exigen el mismo sobre JSON.
- R12 3Q: nueve filas, 221 und; direccion, ciudad, entrega, recibe y nueve bultos
  estan en el original. El prompt anterior permitia omitir metadatos por longitud.

## Cambios y limites

- `docs/Prompt WMS Documentos BBC.txt`: contrato de rechazo explicito, sin limite
  artificial por caracteres; conserva filas/cabecera legibles, no exige totales;
  campos intermedios ausentes usan objetos para evitar desplazamiento posicional.
  Texto del PDF tratado como datos, no instrucciones. No cambia `kw`, modelo,
  permisos, confirmaciones ni flujo operativo.
- `api/_lib/document-pdf-headers.js`: recupera SOLO etiquetas exactas de cabecera
  3Q antes de la tabla, en pares de columnas o `Etiqueta: valor`. No deduce
  identidad documental, SKU, lote, vencimiento ni movimientos. Datos contradictorios
  generan advertencia; no se adivinan columnas desplazadas ni bultos ambiguos.
- `api/_lib/document-pdf-evidence.js`: usa ese complemento en la lectura nativa
  existente. No nuevo proveedor OCR ni segunda integracion paralela.
- Las validaciones de marcadores, catalogo, revision humana, idempotencia y
  transacciones existentes siguen vigentes. No se modificaron registros antiguos.
- Reenviar una remision antigua con bultos antes omitidos puede producir conflicto
  con su identidad operativa previa. No se sobrescribe automaticamente: conservar
  evidencia y corregir el borrador mediante el flujo auditado existente.
- PDFs escaneados, formatos de cabecera distintos o tablas ilegibles siguen
  requiriendo cotejo. No afirmar extraccion perfecta universal ni un limite real
  de salida de BBC que no se haya medido. El readback de configuracion no prueba
  que una inferencia real haya cumplido el prompt.

## Ejecucion (hora Bogota)

| Hora 2026-09-06 | Prueba | Resultado |
|---|---|---|
| 19:47-19:49 | R11/R12, campos por fila, totales separados, cabecera3Q, negativos, determinismo y contrato de ejemplos | Aprobadas localmente; consultas simuladas solo de catalogo |
| 19:49 | Suite y build | 303/303 y build Vite correcto; sin instalar dependencias |
| 19:50 | Actualizacion documental por MCP BBC | El conector devolvio error de esquema `answer.rules[0]`, pero la escritura SI se realizo; lectura posterior coincide exactamente |
| 19:51 | Activacion BBC | Reboot aceptado. No reintento ciego de escritura ni cambios de reglas para acomodar el error del conector |
| 19:52 | Suite incluyendo fixtures nuevos R13 | 304/304; sin base viva ni Siigo |

Prompt anterior SHA256: `81c65da72a766af4b13ed1982a2dc4f41f82db356640a6ec1420c2dd5dfe1d3b`.
Prompt nuevo SHA256: `e92113027c900b96c64761963d7e9f42cef9bd08b6552e782cf9f05d180c7515`.
Flujo: Documentos de Bodega, proyecto Bodega Inventarios. Regla de salida `g0m@s`
conservada y verificada mediante lectura; sin tocar secretos.

## Carga manual pendiente

Desde Juan/admin, enviar sin texto adjunto, de uno en uno al agente:

1. `output/pdf/regresion-documental/20260906-r13/QA-DOC-20260906-R13-OC-SIN-CONTEO-NI-TOTAL.pdf`.
   Debe crear un borrador con once filas, 376 und y 8750 g separados; proveedor,
   referencia y fecha 2026-09-05; once lotes y once vencimientos como en el PDF.
2. `output/pdf/regresion-documental/20260906-r13/QA-DOC-20260906-R13-REMISION-3Q.pdf`.
   Nueve filas, 221 und, nueve bultos; direccion Calle 100 No. 20-30 - Zona industrial,
   Bogota D.C., entrega SOFI - PERFIL ADMINISTRADOR QA, recibe PENDIENTE DE FIRMA EN 3Q.

Referencias nuevas: `QA-DOC-20260906-R13-OC-MULTI-001` y
`QA-DOC-20260906-R13-SALIDA-3Q-001`. No confundir fecha de documento con hora de carga.
PDFs renderizados e inspeccionados visualmente: una pagina cada uno, sin recortes.
La primera alternativa de render no tenia PyMuPDF; Poppler produjo los previews
correctamente, con avisos de fuentes de sustitucion no usadas por estas tablas.

SHA256 OC: `c00f55596acdc3f77d735f92378e1e38280a233bccb058fb6a7edcb2a59a928a`.
SHA256 3Q: `919235979d44120ea1f0da8b891f81478b9f347c7ac7a50a1c459ca983516f6c`.

Por cada carga: registrar hora, expandir Read more, cotejar respuesta, tablero y
SQL, diagnostico nativo/modelo, hash del PDF y ausencia de cambios de inventario.
Despues repetir el mismo archivo para comprobar no duplicacion y repetir negativos
sin marcador/contradictorios. No confirmar OC ni salida durante este ensayo documental.

Si pasa, continuar paquetes 3, 4 y 5 del consolidado. Si falla antes del webhook,
leer la salida y logs actuales de BBC: no culpar al JSON o al PDF sin evidencia.

## Retirada acotada

Revertir solo el commit de este paquete y restaurar el prompt de `10c554a` mediante
MCP con readback. No restaurar todo el repositorio, borrar datos ni modificar las
correcciones del paquete 1. Preservar los cambios ajenos del lockfile y generador PDF.
