import client from './client'

export const getProducts   = (params) => client.get('/products', { params })
export const getProduct    = (id)     => client.get(`/products/${id}`)
export const createProduct = (body)   => client.post('/products', body)
export const updateProduct = (id, body) => client.put(`/products/${id}`, body)
export const toggleProduct = (id)     => client.patch(`/products/${id}/toggle`)
