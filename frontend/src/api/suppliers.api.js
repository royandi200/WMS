import client from './client'

export const listSuppliers = () => client.get('/suppliers').then((response) => response.data)
