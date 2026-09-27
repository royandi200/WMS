import client from './client'

export const listReceptionLotRules = () =>
  client.get('/inventory/reception-lot-rules').then((response) => response.data)

export const updateReceptionLotRule = (body) =>
  client.put('/inventory/reception-lot-rules', body).then((response) => response.data)
