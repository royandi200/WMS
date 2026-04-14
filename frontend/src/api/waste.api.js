import client from './client'

export const listWaste   = (params) => client.get('/waste', { params }).then(r => r.data)
export const reportWaste = (body)   => client.post('/waste', body).then(r => r.data)
