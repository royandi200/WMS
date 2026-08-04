import api from './client'

export const listNotifications = (params = {}) => api.get('/notifications', { params }).then((response) => response.data)
export const retryNotification = (id) => api.post('/notifications', { notificacion_id: id }).then((response) => response.data)
