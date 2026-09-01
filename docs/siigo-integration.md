# Guía de Integración SIIGO

## Decisión operativa vigente

- Las recepciones de compras normales se realizan directamente contra una OC cargada en el WMS. No dependen de una factura de compra importada desde Siigo.
- Las recepciones de producto terminado tercerizado se realizan contra una orden de maquila 3Q y su OC asociada.
- Las facturas de venta de Siigo son el origen contable de los despachos: el WMS crea la tarea pendiente, asigna lotes y descuenta inventario solo cuando se confirma la salida fisica.
- Siigo conserva su papel contable; el WMS conserva la verdad operativa de lotes, ubicaciones, condiciones y movimientos fisicos.

## Requisitos

1. Cuenta activa en SIIGO con API habilitada
2. Credenciales de acceso: `SIIGO_USERNAME` y `SIIGO_ACCESS_KEY`
3. `SIIGO_PARTNER_ID` asignado por SIIGO para tu integración

## Flujo de Autenticación

SIIGO usa autenticación mediante **Bearer Token** con expiración.
El servicio `siigo.service.js` gestiona automáticamente el refresco del token.

```
POST https://api.siigo.com/auth
{
  "username":   "tu@email.com",
  "access_key": "tu_access_key"
}
```

## Endpoints Usados

| Módulo WMS | Endpoint SIIGO | Método |
|---|---|---|
| Sincronizar productos | `/v1/products` | GET |
| Facturas de venta para despachos | `/v1/invoices` | GET |
| Terceros usados como clientes o proveedores | `/v1/customers` | GET |
| Compras de prueba heredadas, no requeridas para recibir | `/v1/purchases` | GET/POST |

## Sincronización de Productos

Ejecutar manualmente o programar con cron:

```bash
GET /api/v1/siigo/sync/productos
```

Esto trae todos los productos activos de SIIGO y los inserta/actualiza en la tabla `productos` local.

## Registro de movimientos

Los movimientos fisicos se registran primero en el WMS con lote, ubicacion, usuario y referencia operativa. El flujo vigente no debe asumir que cada recepcion o despacho genera automaticamente un ajuste de inventario en Siigo. Cualquier sincronizacion contable adicional se habilitara solo despues de validarla con la cuenta real del cliente.

## Referencias

- [Documentación oficial SIIGO Developers](https://developers.siigo.com/docs)
- [Portal de desarrolladores SIIGO](https://developers.siigo.com)
