# Guía de Integración SIIGO

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
| Órdenes de compra | `/v1/purchase-orders` | GET |
| Órdenes de venta | `/v1/invoices` | GET |
| Clientes | `/v1/customers` | GET |
| Proveedores | `/v1/suppliers` | GET |
| Ajuste de inventario | `/v1/inventory-adjustments` | POST |

## Sincronización de Productos

Ejecutar manualmente o programar con cron:

```bash
GET /api/v1/siigo/sync/productos
```

Esto trae todos los productos activos de SIIGO y los inserta/actualiza en la tabla `productos` local.

## Registro de Movimientos

Cada vez que se completa una recepción o despacho en el WMS,
se envía automáticamente un ajuste de inventario a SIIGO.
Si falla, queda en cola (`siigo_sync = 0`) para reintento.

## Referencias

- [Documentación oficial SIIGO Developers](https://developers.siigo.com/docs)
- [Portal de desarrolladores SIIGO](https://developers.siigo.com)
