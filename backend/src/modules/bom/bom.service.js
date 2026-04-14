const { BOM, Producto } = require('../../models');
const AppError = require('../../utils/AppError');

exports.getByProduct = async (producto_final_id) => {
  const bom = await BOM.findAll({
    where: { producto_final_id },
    include: [
      { model: Producto, as: 'producto_final', attributes: ['siigo_code','nombre','unidad'] },
      { model: Producto, as: 'insumo',         attributes: ['siigo_code','nombre','unidad'] }
    ]
  });
  if (!bom.length) throw new AppError('No se encontró BOM para este producto', 404);
  return bom;
};

exports.upsert = async (data) => {
  const [record, created] = await BOM.findOrCreate({
    where: { producto_final_id: data.producto_final_id, insumo_id: data.insumo_id },
    defaults: data
  });
  if (!created) await record.update(data);
  return record;
};

exports.remove = async (id) => {
  const b = await BOM.findByPk(id);
  if (!b) throw new AppError('Línea BOM no encontrada', 404);
  await b.destroy();
};
