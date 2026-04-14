const { sequelize } = require('../config/database');
const User = require('./User');
const Role = require('./Role');
const Product = require('./Product');
const Lot = require('./Lot');
const Kardex = require('./Kardex');
const ProductionOrder = require('./ProductionOrder');
const BOM = require('./BOM');
const WasteRecord = require('./WasteRecord');
const ApprovalQueue = require('./ApprovalQueue');
const SystemLog = require('./SystemLog');

// ── Asociaciones ────────────────────────────────────────────────────────────
Role.hasMany(User, { foreignKey: 'role_id', as: 'users' });
User.belongsTo(Role, { foreignKey: 'role_id', as: 'role' });

Product.hasMany(Lot,             { foreignKey: 'product_id', as: 'lots' });
Product.hasMany(BOM,             { foreignKey: 'product_id', as: 'bom_as_final' });
Product.hasMany(BOM,             { foreignKey: 'input_product_id', as: 'bom_as_input' });
Product.hasMany(Kardex,          { foreignKey: 'product_id', as: 'kardex_entries' });

Lot.belongsTo(Product,           { foreignKey: 'product_id', as: 'product' });
Lot.hasMany(Kardex,              { foreignKey: 'lot_id', as: 'kardex_entries' });

Kardex.belongsTo(Lot,            { foreignKey: 'lot_id', as: 'lot' });
Kardex.belongsTo(Product,        { foreignKey: 'product_id', as: 'product' });
Kardex.belongsTo(User,           { foreignKey: 'user_id', as: 'user' });

ProductionOrder.belongsTo(Product, { foreignKey: 'product_id', as: 'product' });
ProductionOrder.belongsTo(User,    { foreignKey: 'created_by', as: 'creator' });
ProductionOrder.belongsTo(User,    { foreignKey: 'approved_by', as: 'approver' });

BOM.belongsTo(Product, { foreignKey: 'product_id', as: 'final_product' });
BOM.belongsTo(Product, { foreignKey: 'input_product_id', as: 'input_product' });

WasteRecord.belongsTo(Product, { foreignKey: 'product_id', as: 'product' });
WasteRecord.belongsTo(Lot,     { foreignKey: 'lot_id', as: 'lot' });
WasteRecord.belongsTo(User,    { foreignKey: 'reported_by', as: 'reporter' });
WasteRecord.belongsTo(User,    { foreignKey: 'approved_by', as: 'approver' });

ApprovalQueue.belongsTo(User,  { foreignKey: 'requested_by', as: 'requester' });
ApprovalQueue.belongsTo(User,  { foreignKey: 'processed_by', as: 'processor' });

module.exports = {
  sequelize,
  User, Role, Product, Lot, Kardex,
  ProductionOrder, BOM, WasteRecord,
  ApprovalQueue, SystemLog
};
