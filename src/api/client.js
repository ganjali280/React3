const API_URL = 'http://localhost:3001/api';

const request = async (path, { method = 'GET', body, userId } = {}) => {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (userId) headers['x-user-id'] = String(userId);

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || data.error || 'Ошибка запроса');
  return data;
};

export const getServices = () => request('/services');

export const getProducts = () => request('/products');

export const getCategories = () => request('/categories');

export const login = (email, password) =>
  request('/auth/login', { method: 'POST', body: { email, password } });

export const checkout = (userId, items) =>
  request('/checkout', { method: 'POST', body: { items }, userId });

export const getMyOrders = (userId) => request('/my-orders', { userId });

// ===== Админ =====

export const addCategory = (userId, name) =>
  request('/categories', { method: 'POST', body: { name }, userId });

export const getUsers = (userId) => request('/users', { userId });

export const setUserDiscount = (userId, payload) =>
  request('/users/discount', { method: 'PATCH', body: payload, userId });

export const setItemDiscount = (userId, type, id, discount_percent) =>
  request(`/${type === 'service' ? 'services' : 'products'}/${id}/discount`, {
    method: 'PATCH',
    body: { discount_percent },
    userId,
  });
