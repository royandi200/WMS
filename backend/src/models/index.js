const { sequelize } = require('../config/database');

// ── Modelos base ─────────────────────────────────────────────────────────────
const User            = require('./User');
const Role            = require('./Role');
const Product         = require('./Product');
const Bodega          = require('./Bodega');
const Ubicacion       = require('./Ubicacion');
const Sku             = require('./Sku');
const Stock           = require('./Stock');           // legacy — solo lectura
const Movimiento      = require('./Movimiento');      // legacy — solo lectura
const Lot             = require('./Lot');             // fuente de verdad de inventario
const Kardex          = require('./Kardex');          // log inmutable de movimientos
const Tercero         = require('./Tercero');
const { Recepcion, RecepcionItem } = require('./Recepcion');
const { Despacho, DespachoItem }   = require('./Despacho');
const WasteRecord     = require('./WasteRecord');
const ApprovalQueue   = require('./ApprovalQueue');
const ProductionOrder = require('./ProductionOrder');
const BOM             = require('./BOM');
const WebhookLog      = require('./WebhookLog');
const SystemLog       = require('./SystemLog');

// ── Asociaciones ─────────────────────────────────────────────────────────────

// Roles ↔ Usuarios
Role.hasMany(User,     { foreignKey: 'rol_id', as: 'usuarios' });
User.belongsTo(Role,   { foreignKey: 'rol_id', as: 'rol' });

// Bodegas ↔ Ubicaciones
Bodega.hasMany(Ubicacion,   { foreignKey: 'bodega_id', as: 'ubicaciones' });
Ubicacion.belongsTo(Bodega, { foreignKey: 'bodega_id', as: 'bodega' });

// Productos ↔ SKUs
Product.hasMany(Sku,   { foreignKey: 'producto_id', as: 'skus' });
Sku.belongsTo(Product, { foreignKey: 'producto_id', as: 'producto' });

// Productos ↔ Stock (legacy)
Product.hasMany(Stock,   { foreignKey: 'producto_id', as: 'stock_entries' });
Stock.belongsTo(Product, { foreignKey: 'producto_id', as: 'producto' });
Bodega.hasMany(Stock,    { foreignKey: 'bodega_id',   as: 'stock_entries' });
Stock.belongsTo(Bodega,  { foreignKey: 'bodega_id',   as: 'bodega' });
Ubicacion.hasMany(Stock,    { foreignKey: 'ubicacion_id', as: 'stock_entries' });
Stock.belongsTo(Ubicacion,  { foreignKey: 'ubicacion_id', as: 'ubicacion' });

// Productos ↔ Lots (nueva arquitectura)
Product.hasMany(Lot,   { foreignKey: 'product_id', as: 'lots' });
Lot.belongsTo(Product, { foreignKey: 'product_id', as: 'producto' });
User.hasMany(Lot,      { foreignKey: 'received_by', as: 'lotes_recibidos' });
Lot.belongsTo(User,    { foreignKey: 'received_by', as: 'receptor' });
ProductionOrder.hasMany(Lot,   { foreignKey: 'production_order_id', as: 'lots_producidos' });
Lot.belongsTo(ProductionOrder, { foreignKey: 'production_order_id', as: 'orden' });

// Kardex
Product.hasMany(Kardex,   { foreignKey: 'product_id', as: 'kardex_entries' });
Kardex.belongsTo(Product, { foreignKey: 'product_id', as: 'producto' });
Lot.hasMany(Kardex,       { foreignKey: 'lot_id',     as: 'movimientos' });
Kardex.belongsTo(Lot,     { foreignKey: 'lot_id',     as: 'lot' });
User.hasMany(Kardex,      { foreignKey: 'user_id',    as: 'kardex_entries' });
Kardex.belongsTo(User,    { foreignKey: 'user_id',    as: 'usuario' });

// Movimientos (legacy)
Product.hasMany(Movimiento,   { foreignKey: 'producto_id', as: 'movimientos' });
Movimiento.belongsTo(Product, { foreignKey: 'producto_id', as: 'producto' });
User.hasMany(Movimiento,      { foreignKey: 'usuario_id',  as: 'movimientos' });
Movimiento.belongsTo(User,    { foreignKey: 'usuario_id',  as: 'usuario' });

// Terceros ↔ Recepciones/Despachos
Tercero.hasMany(Recepcion,   { foreignKey: 'tercero_id', as: 'recepciones' });
Recepcion.belongsTo(Tercero, { foreignKey: 'tercero_id', as: 'tercero' });
Tercero.hasMany(Despacho,    { foreignKey: 'tercero_id', as: 'despachos' });
Despacho.belongsTo(Tercero,  { foreignKey: 'tercero_id', as: 'tercero' });

// Recepciones ↔ Items
Recepcion.hasMany(RecepcionItem,   { foreignKey: 'recepcion_id', as: 'items' });
RecepcionItem.belongsTo(Recepcion, { foreignKey: 'recepcion_id', as: 'recepcion' });
RecepcionItem.belongsTo(Product,   { foreignKey: 'producto_id',  as: 'producto' });
Product.hasMany(RecepcionItem,     { foreignKey: 'producto_id',  as: 'recepcion_items' });

// Despachos ↔ Items
Despacho.hasMany(DespachoItem,   { foreignKey: 'despacho_id', as: 'items' });
DespachoItem.belongsTo(Despacho, { foreignKey: 'despacho_id', as: 'despacho' });
DespachoItem.belongsTo(Product,  { foreignKey: 'producto_id', as: 'producto' });
Product.hasMany(DespachoItem,    { foreignKey: 'producto_id', as: 'despacho_items' });

// Usuarios ↔ Recepciones/Despachos
User.hasMany(Recepcion,   { foreignKey: 'usuario_id', as: 'recepciones' });
Recepcion.belongsTo(User, { foreignKey: 'usuario_id', as: 'usuario' });
User.hasMany(Despacho,    { foreignKey: 'usuario_id', as: 'despachos' });
Despacho.belongsTo(User,  { foreignKey: 'usuario_id', as: 'usuario' });

// BOM
BOM.belongsTo(Product, { foreignKey: 'producto_final_id', as: 'producto_final' });
BOM.belongsTo(Product, { foreignKey: 'insumo_id',         as: 'insumo' });
Product.hasMany(BOM,   { foreignKey: 'producto_final_id', as: 'bom_como_final' });
Product.hasMany(BOM,   { foreignKey: 'insumo_id',         as: 'bom_como_insumo' });

// Ordenes de Produccion
ProductionOrder.belongsTo(Product, { foreignKey: 'producto_id',  as: 'producto' });
ProductionOrder.belongsTo(User,    { foreignKey: 'creado_por',   as: 'creador' });
ProductionOrder.belongsTo(User,    { foreignKey: 'aprobado_por', as: 'aprobador' });
Product.hasMany(ProductionOrder,   { foreignKey: 'producto_id',  as: 'ordenes' });

// Mermas — incluye FK a Lot (nueva) y ProductionOrder
WasteRecord.belongsTo(Product,         { foreignKey: 'producto_id',   as: 'producto' });
WasteRecord.belongsTo(User,            { foreignKey: 'reportado_por', as: 'reportador' });
WasteRecord.belongsTo(User,            { foreignKey: 'aprobado_por',  as: 'aprobador' });
WasteRecord.belongsTo(ProductionOrder, { foreignKey: 'orden_id',      as: 'orden' });
WasteRecord.belongsTo(Lot,             { foreignKey: 'lot_id',        as: 'lot' });
Lot.hasMany(WasteRecord,               { foreignKey: 'lot_id',        as: 'mermas' });

// Aprobaciones
ApprovalQueue.belongsTo(User, { foreignKey: 'solicitado_por', as: 'solicitante' });
ApprovalQueue.belongsTo(User, { foreignKey: 'procesado_por',  as: 'procesador' });

module.exports = {
  sequelize,
  // Auth
  User, Role,
  // Catalogo
  Product, Sku, BOM,
  // Almacen — nueva arquitectura
  Lot, Kardex,
  // Almacen — legacy (mantener hasta migracion completa)
  Bodega, Ubicacion, Stock, Movimiento,
  // Comercial
  Tercero, Recepcion, RecepcionItem, Despacho, DespachoItem,
  // Operaciones
  ProductionOrder, WasteRecord, ApprovalQueue,
  // Sistema
  WebhookLog, SystemLog
};
