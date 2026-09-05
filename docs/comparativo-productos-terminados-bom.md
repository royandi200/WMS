# Comparativo de productos terminados y BOM

Fecha de verificacion: 2026-09-01
Fuente: [Acta de actualizacion de alcance y requisitos WMS - Infinity Brands](https://docs.google.com/document/d/1-VYAI9UawsEd-BaHsdD0Uck3BQ_jS5L21GgGIiqn4Tg/edit?tab=t.0)

## Alcance

Este documento compara:

- La seccion 4 del acta: catalogo de productos terminados.
- La seccion 5.2 del acta: referencias con BOM y modalidad operativa `PT-PR-IO`.

La columna `BOM recibido` de la seccion 4 no se utilizo porque contiene informacion desactualizada.

## Convenciones

| Codigo | Modalidad operativa |
|---|---|
| `PR` | Producto fabricado internamente por Infinity Brands. |
| `PT` | Producto cuyo envasado o produccion se terceriza. |
| `IO` | Producto terminado de entrada y salida (in-and-out). |

Todos los registros de la seccion 4 son productos terminados. La modalidad `PR`, `PT` o `IO` indica como se obtiene cada producto.

## Resumen del cruce

| Resultado | Referencias |
|---|---:|
| Presentes en las secciones 4 y 5.2 | 26 |
| Presentes solo en la seccion 4 | 13 |
| Presentes solo en la seccion 5.2 | 4 |

## Referencias presentes en ambas secciones

### Produccion interna (`PR`)

| Codigo | Producto |
|---|---|
| `00102-PTASH60` | PRODUCTO TERMINADO ASHWAGANDHA X 60 |
| `00106-PTCLT60` | PRODUCTO TERMINADO CALM TEDDYS TARRO x 60G |
| `00106-PTCV60` | PRODUCTO TERMINADO CALM VIBES TARRO x 60G |
| `00109-PTCOL60` | PRODUCTO TERMINADO COLAGENO Y BIOTINA TARRO x 60G |
| `00110-PTCG120` | PRODUCTO TERMINADO CREAGUMS X 120G |
| `00114-PTGF60` | GREEN FIT TARRO x 60G |
| `00118-PTMTLS60` | MENTALIS TARRO x 60G |
| `00120-PTPBT60` | PRODUCTO TERMINADO PROBIOTICOS 60 |
| `00125-PTVM60` | PRODUCTO TERMINADO VINAGRE DE MANZANA TARRO x 60G |
| `00200-PTASH120` | PRODUCTO TERMINADO ASHWAGANDHA X 120 |
| `00201-PTPBS120` | PRODUCTO TERMINADO PROBIOTICOS 120 |
| `00203-PTMTL120` | PRODUCTO TERMINADO MENTALIS 120 |
| `00204-PTVM120` | PRODUCTO TERMINADO VINAGRE DE MANZANA 120 |
| `00205-PTCV120` | PRODUCTO TERMINADO CALM VIBES 120 |
| `00206-PTCG140` | PRODUCTO TERMINADO CREAGUMS 140 |
| `00207-PTAHSLB` | PRODUCTO TERMINADO ASGWAGANDHA LINEA BLANCA |
| `00208-PTRESVLB` | PRODUCTO TERMINADO RESVERATROL LINEA BLANCA |

### Produccion o envasado tercerizado (`PT`)

| Codigo | Producto |
|---|---|
| `00105-PTBOS60` | PRODUCTO TERMINADO BOOSTER X 60 |
| `00202-PTRESV120` | PRODUCTO TERMINADO RESVERATROL 120 |
| `00231-PTRES60` | PRODUCTO TERMINADO RESVERATROL 60 |

### Entrada y salida (`IO`)

| Codigo | Producto |
|---|---|
| `00276-PTZNASHWA` | PRODUCTO TERMINADO ZENOVA ASHWAGANDHA |
| `00277-PTZNREM` | PRODUCTO TERMINADO ZENOVA REMOLACHA |
| `00278-PTZNCUR` | PRODUCTO TERMINADO ZENOVA CURCUMA |
| `00279-PTZNINO` | PRODUCTO TERMINADO ZENOVA INOSITOL |
| `00280-PTZNQUE` | PRODUCTO TERMINADO ZENOVA QUEEN |
| `00281-PTZNMAG` | PRODUCTO TERMINADO ZENOVA MAGNESIO |

## Referencias presentes en la seccion 4, pero no en la 5.2

Estas 13 referencias son productos terminados, pero no tienen BOM ni modalidad `PR`, `PT` o `IO` definida en la seccion 5.2. La modalidad no debe inferirse.

| Codigo | Producto | Modalidad |
|---|---|---|
| `00101-PTMCL60` | MENOCALM TARRO x 60G | Sin definir |
| `00103-PTAUR` | AURA FRESH - SOUL-SERENITY-ROSE LOVE | Sin definir |
| `00104-PTBLNC60` | PRODUCTO TERMINADO BALANCE X 60 | Sin definir |
| `00108-PTCBS60` | PRODUCTO TERMINADO COFEE BOOSTER TARRO x 60G | Sin definir |
| `00111-PTFUN` | FUNGI CAFE | Sin definir |
| `00112-PTGT60` | PRODUCTO TERMINADO GARGANTOX TARRO x 60G | Sin definir |
| `00113-PTGES60` | GESTAR TARRO x 60G | Sin definir |
| `00116-PTH&N60` | HAIR VITAMINS TARRO x 60G | Sin definir |
| `00117-PTMGF60` | MEGFULL TARRO x 60G | Sin definir |
| `00121-PTPG60` | PRODUCTO TERMINADO PRO G 60 | Sin definir |
| `00123-PTSLW60` | PRODUCTO TERMINADO SOLAR LOW 60 | Sin definir |
| `00126-PTLUM` | LUMIA MULTIESTILIZADOR CABELLO | Sin definir |
| `00202-PTGT60` | PRODUCTO TERMINADO GREEN TEDDYS X 60 | Sin definir |

## Referencias presentes en la seccion 5.2, pero no en la 4

La seccion 5.2 no proporciona un nombre de producto para estas referencias. Todas estan clasificadas como produccion interna (`PR`).

| Codigo | Nombre en el documento | Modalidad |
|---|---|---|
| `00286-PTCOLV` | No informado en la seccion 5.2 | `PR` - produccion interna |
| `00286-SAMPV` | No informado en la seccion 5.2 | `PR` - produccion interna |
| `00287-PTVV` | No informado en la seccion 5.2 | `PR` - produccion interna |
| `00287-SAMPCV` | No informado en la seccion 5.2 | `PR` - produccion interna |

## Informacion pendiente del cliente

1. Definir la modalidad `PR`, `PT` o `IO` de las 13 referencias que solo aparecen en la seccion 4.
2. Entregar el BOM de las referencias que correspondan a produccion interna o tercerizada y requieran control de materiales.
3. Confirmar si las cuatro referencias que solo aparecen en la seccion 5.2 siguen vigentes y deben agregarse al catalogo de la seccion 4.
4. Informar el nombre comercial de esas cuatro referencias.

Hasta resolver estas diferencias, el catalogo de productos terminados y la matriz de BOM no deben considerarse completamente conciliados.
