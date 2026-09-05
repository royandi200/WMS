import client from './client'

export const listAlertSettings = (search = '') =>
  client.get('/inventory/alert-settings', { params: search ? { search } : {} }).then((response) => response.data)

export const updateAlertSettings = (body) =>
  client.put('/inventory/alert-settings', body).then((response) => response.data)
