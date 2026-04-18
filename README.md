# 📦 WMS — Warehouse Management System

> Sistema de Gestión de Almacén integrado con **SIIGO** y base de datos **MySQL**.
> Interfaz limpia, rápida y pensada para el usuario final.

---

## 🚀 Stack Tecnológico

| Capa | Tecnología |
|---|---|
| Frontend | React + Tailwind CSS |
| Backend | Node.js (Express) |
| Base de datos | MySQL 8.x |
| Integración ERP | SIIGO API REST |
| Autenticación | JWT |
| Despliegue | Docker + Docker Compose |

---

## 📋 Módulos del Sistema

### 1. 📥 Recepciones (Entradas)
- Crear órdenes de recepción desde órdenes de compra SIIGO
- Verificación de cantidades y lotes
- Generación automática de movimientos en SIIGO

### 2. 📤 Despachos (Salidas)
- Picking basado en órdenes de venta SIIGO
- Confirmación de despacho con actualización de inventario
- Impresión de guías y etiquetas

### 3. 🗃️ Inventario
- Consulta en tiempo real del stock por ubicación
- Transferencias entre bodegas
- Inventarios cíclicos y generales

### 4. 📍 Ubicaciones y Bodegas
- Gestión de zonas, pasillos, estantes y posiciones
- Mapa visual del almacén

### 5. 🔄 Sincronización SIIGO
- Sincronización bidireccional de productos, clientes y proveedores
- Cola de eventos para movimientos de inventario
- Webhook listener para actualizaciones automáticas

### 6. 📊 Reportes y Dashboards
- KPIs en tiempo real (entradas, salidas, stock crítico)
- Historial de movimientos con filtros
- Exportación a Excel/PDF

---

## 🏗️ Estructura del Proyecto

```
WMS/
├── backend/               # API REST (Node.js + Express)
│   ├── src/
│   │   ├── config/        # Configuración DB, SIIGO, JWT
│   │   ├── controllers/   # Lógica de negocio
│   │   ├── models/        # Modelos Sequelize (MySQL)
│   │   ├── routes/        # Definición de endpoints
│   │   ├── services/      # Servicios (SIIGO, reportes)
│   │   ├── middlewares/   # Auth, validación, errores
│   │   └── utils/         # Helpers, constantes
│   ├── migrations/        # Migraciones de base de datos
│   └── package.json
│
├── frontend/              # Aplicación React
│   ├── src/
│   │   ├── components/    # Componentes reutilizables
│   │   ├── pages/         # Páginas principales
│   │   ├── hooks/         # Custom hooks
│   │   ├── services/      # Llamadas a la API
│   │   ├── store/         # Estado global (Zustand)
│   │   └── utils/         # Helpers del frontend
│   └── package.json
│
├── database/
│   ├── schema.sql         # Esquema inicial de la BD
│   └── seeds/             # Datos de prueba
│
├── docs/
│   ├── architecture.md    # Diagrama de arquitectura
│   ├── api.md             # Documentación de la API
│   └── siigo-integration.md  # Guía de integración SIIGO
│
├── docker-compose.yml     # Orquestación de servicios
├── .env.example           # Variables de entorno (plantilla)
└── README.md
```

---

## ⚙️ Configuración Rápida

### 1. Clonar el repositorio
```bash
git clone https://github.com/royandi200/WMS.git
cd WMS
```

### 2. Copiar variables de entorno
```bash
cp .env.example .env
# Editar .env con tus credenciales
```

### 3. Levantar con Docker
```bash
docker-compose up -d
```

### 4. Ejecutar migraciones
```bash
cd backend && npm run db:migrate
```

### 5. Acceder a la aplicación
- **Frontend:** http://localhost:3000
- **Backend API:** http://localhost:4000
- **API Docs (Swagger):** http://localhost:4000/api-docs

---

## 🔐 Variables de Entorno

Ver `.env.example` para la lista completa de variables requeridas.

---

## 🤝 Integración SIIGO

Este WMS usa la **API REST de SIIGO** para:
- Sincronizar el catálogo de productos
- Leer órdenes de compra y venta
- Registrar entradas y salidas de inventario
- Actualizar saldos de inventario en tiempo real

Consulta [`docs/siigo-integration.md`](docs/siigo-integration.md) para la guía completa de configuración.

---

## 📌 Roadmap

- [x] Estructura inicial del proyecto
- [ ] Autenticación y gestión de usuarios
- [ ] Módulo de recepción de mercancía
- [ ] Módulo de despachos
- [ ] Integración SIIGO (productos y órdenes)
- [ ] Sincronización bidireccional de inventario
- [ ] Dashboard y reportes
- [ ] App móvil para operadores de bodega
- [ ] Lector de códigos de barras / QR

---

## 📄 Licencia

Proyecto privado. Todos los derechos reservados.

---

*Última actualización: Abril 2026*

Validación de acceso a GitHub.

Línea de actualización documental.
