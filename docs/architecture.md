# Arquitectura del Sistema WMS

## Diagrama de Alto Nivel

```
┌─────────────────────────────────────────────────────┐
│                   NAVEGADOR / USUARIO                │
└─────────────────────────────────────────────────────┘
                          │  HTTP/S
                          ▼
┌─────────────────────────────────────────────────────┐
│              FRONTEND (React + Tailwind)             │
│  Login │ Dashboard │ Recepciones │ Despachos │ Stock │
└─────────────────────────────────────────────────────┘
                          │  REST API (JSON)
                          ▼
┌─────────────────────────────────────────────────────┐
│              BACKEND (Node.js + Express)             │
│  Auth JWT │ Controllers │ Services │ Validations    │
└────────────────────┬────────────────────────────────┘
          ┌──────────┴──────────┐
          ▼                     ▼
┌─────────────────┐  ┌──────────────────────────────┐
│   MySQL 8.x     │  │   SIIGO API REST              │
│  (Base de datos │  │  auth / products / invoices   │
│   principal)    │  │  inventory-adjustments         │
└─────────────────┘  └──────────────────────────────┘
```

## Principios de Diseño

- **API First**: el frontend y sistemas externos consumen la misma API
- **Sync asíncrona con SIIGO**: los fallos de SIIGO no bloquean operaciones del almacén
- **Interfaz UI/UX First**: cada pantalla está diseñada pensando en el operario de bodega
- **Trazabilidad total**: todo movimiento queda registrado con usuario, fecha y referencia
