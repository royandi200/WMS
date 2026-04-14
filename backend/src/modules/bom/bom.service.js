const { BOM, Product } = require('../../models');
const AppError = require('../../utils/AppError');

exports.getByProduct = async (product_id) => {
  const bom = await BOM.findAll({
    where: { product_id },
    include: [
      { model: Product, as: 'final_product', attributes: ['sku','name','unit'] },
      { model: Product, as: 'input_product', attributes: ['sku','name','unit'] }
    ]
  });
  if (!bom.length) throw new AppError('No se encontró BOM para este producto', 404);
  return bom;
};

exports.upsert = async (data) => {
  const [record, created] = await BOM.findOrCreate({
    where: { product_id: data.product_id, input_product_id: data.input_product_id },
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
