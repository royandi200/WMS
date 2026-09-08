# Checkpoint: demo manual validado (2026-09-08)

Este checkpoint conserva el codigo comprometido con el que se ejecutaron correctamente las ultimas pruebas manuales de recepcion, produccion, maquila 3Q y despacho.

## Referencia recuperable

- Rama: `checkpoint/demo-manual-validado-20260908`
- Etiqueta local: `checkpoint-demo-manual-validado-20260908`
- Commit: `f2bde539f8f8e3b479acee04e5b96ae858bb3737`
- Guia operativa usada: `docs/demo-tres-flujos-repetibles-2026-09-07.md`
- Evidencia final de datos: `output/qa/demo-trio-20260907/despues-ensayo-final-20260908.json`
- Huella de la evidencia: `15a6d895e23f959adcc581bf2354560d9ea34f60f0c6c0ae547ac70f2588a52c`

## Alcance

La rama permite volver al codigo conocido que soporta el demo manual probado. No incluye los archivos locales que ya estaban sin seguimiento ni los cambios documentales sin commit existentes al crear el checkpoint.

La evidencia JSON es una fotografia verificable y acotada de los SKU y flujos ensayados. **No es un backup de base de datos y no restaura inventario.** Para repetir el demo debe partirse de una base preparada o limpia y usar referencias nuevas, siguiendo la guia operativa.

## Recuperacion segura

Antes de recuperar, guardar cualquier cambio local que se quiera conservar. Para comparar la implementacion actual con el punto estable:

```powershell
git -c safe.directory=C:/Users/juanr/Documents/WMS/WMS-location-editor diff checkpoint/demo-manual-validado-20260908 -- api frontend/src
```

Si se decide revertir solamente los archivos del nuevo flujo de maquila, restaurarlos de forma selectiva desde la rama del checkpoint. No cambiar de rama ni restaurar todo el arbol mientras existan cambios locales ajenos.

## Plan alterno para el demo

Si la simplificacion nueva de maquila falla durante la validacion, el demo frente al cliente se puede ejecutar con el flujo manual ya comprobado:

1. Cargar y revisar el documento de salida 3Q.
2. Crear por separado la orden/remision 3Q con el mismo producto, cantidad, maquilador y materiales del documento.
3. Confirmar la remision desde el dashboard o WhatsApp y comprobar inventario/Kardex.
4. Cargar la OC del producto terminado y vincularla **manualmente** con la orden 3Q.
5. Preparar y confirmar las recepciones de producto terminado; luego realizar el despacho final.

La vinculacion de la OC permanece manual tanto en el flujo estable como en la simplificacion nueva.
