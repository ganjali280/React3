import { containsProhibitedRequestText } from '../validation';

const API_URL = 'http://localhost:3001/api';
const BACKEND_UNAVAILABLE_EVENT = 'app:backend-unavailable';

// Уведомляет приложение о недоступности сервера.
const notifyBackendUnavailable = (message) => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(BACKEND_UNAVAILABLE_EVENT, { detail: message }));
  }
};

// Отправляет запрос к API, обрабатывает ошибки и сообщает о недоступности сервера.
const request = async (path, { method = 'GET', body } = {}) => {
  if (body && containsProhibitedRequestText(body, path)) {
    throw new Error('Текстовое поле содержит недопустимые слова');
  }

  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    if (error instanceof TypeError) {
      const message = 'Сервер недоступен. Проверьте, запущен ли backend на порту 3001.';
      notifyBackendUnavailable(message);
      throw new Error(message);
    }
    throw error;
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`Сервер вернул некорректный ответ (HTTP ${res.status})`);
  }
  if (!res.ok) {
    if (path === '/test' && res.status >= 500) {
      notifyBackendUnavailable(data?.message || 'Backend или база данных недоступны.');
    }
    throw new Error(
      data?.message || data?.error || `Ошибка запроса (HTTP ${res.status})`
    );
  }
  return data;
};

export const backendUnavailableEvent = BACKEND_UNAVAILABLE_EVENT;

// Проверяет доступность серверного API.
export const checkBackendStatus = () => request('/test');

// Загружает список услуг.
export const getServices = () => request('/services');

// Загружает список товаров с учётом пользователя.
export const getProducts = (userId) => request('/products', { userId });

// Загружает список категорий каталога.
export const getCategories = () => request('/categories');

// Выполняет вход пользователя.
export const login = (email, password) =>
  request('/auth/login', { method: 'POST', body: { email, password } });

// Получает сведения о текущем пользователе.
export const getCurrentSession = async () => {
  const result = await request('/auth/session');
  return result.user;
};

// Завершает текущую пользовательскую сессию.
export const logout = () => request('/auth/logout', { method: 'POST' });

// Запрашивает код для восстановления пароля.
export const requestPasswordReset = (email) =>
  request('/auth/forgot-password', { method: 'POST', body: { email } });

// Устанавливает новый пароль с помощью кода восстановления.
export const resetPassword = (email, code, new_password) =>
  request('/auth/reset-password', {
    method: 'POST',
    body: { email, code, new_password },
  });

// Регистрирует нового пользователя.
export const register = (name, email, password, phone) =>
  request('/auth/register', { method: 'POST', body: { name, email, password, phone } });

// Оформляет заказ из корзины.
export const checkout = (userId, payload) =>
  request('/checkout', { method: 'POST', body: payload, userId });

// Загружает корзину пользователя.
export const getCart = (userId) => request('/cart', { userId });

// Сохраняет состав корзины пользователя.
export const saveCart = (userId, items) =>
  request('/cart', { method: 'PUT', body: { items }, userId });

// Загружает историю заказов пользователя.
export const getMyOrders = (userId) => request('/my-orders', { userId });

// Создаёт категорию каталога.
export const addCategory = (userId, name) =>
  request('/categories', { method: 'POST', body: { name }, userId });

// Удаляет категорию каталога.
export const deleteCategory = (userId, categoryId) =>
  request(`/categories/${categoryId}`, { method: 'DELETE', userId });

// Добавляет товар или услугу в каталог.
export const createCatalogItem = (userId, type, payload) =>
  request(`/admin/catalog/${type}`, { method: 'POST', body: payload, userId });

// Обновляет товар или услугу в каталоге.
export const updateCatalogItem = (userId, type, itemId, payload) =>
  request(`/admin/catalog/${type}/${itemId}`, {
    method: 'PATCH',
    body: payload,
    userId,
  });

// Удаляет товар или услугу из каталога.
export const deleteCatalogItem = (userId, type, itemId) =>
  request(`/admin/catalog/${type}/${itemId}`, { method: 'DELETE', userId });

// Загружает персональные купоны клиентов.
export const getCoupons = (userId) => request('/coupons', { userId });

// Загружает купоны, доступные текущему пользователю.
export const getAvailableCoupons = () => request('/coupons/available');

// Проверяет возможность применения купона к корзине.
export const validateCoupon = (userId, payload) =>
  request('/coupons/validate', { method: 'POST', body: payload, userId });

// Загружает купоны для управления в панели администратора.
export const getAdminCoupons = (userId) => request('/admin/coupons', { userId });

// Создаёт купон в панели администратора.
export const createAdminCoupon = (userId, payload) =>
  request('/admin/coupons', { method: 'POST', body: payload, userId });

// Обновляет купон в панели администратора.
export const updateAdminCoupon = (userId, couponId, payload) =>
  request(`/admin/coupons/${couponId}`, { method: 'PATCH', body: payload, userId });

// Удаляет купон в панели администратора.
export const deleteAdminCoupon = (userId, couponId) =>
  request(`/admin/coupons/${couponId}`, { method: 'DELETE', userId });

// Загружает отзывы об услуге.
export const getServiceReviews = (serviceId) => request(`/services/${serviceId}/reviews`);

// Проверяет право пользователя оставить отзыв об услуге.
export const getServiceReviewEligibility = (serviceId) =>
  request(`/services/${serviceId}/review-eligibility`);

// Загружает отзывы о товаре.
export const getProductReviews = (productId) => request(`/products/${productId}/reviews`);

// Загружает завершённые заказы товара, доступные для отзыва.
export const getProductReviewOrders = (productId) =>
  request(`/products/${productId}/review-orders`);

// Загружает отзывы для панели администратора.
export const getAdminReviews = (userId) => request('/admin/reviews', { userId });

// Удаляет отзыв администратора по причине нарушения правил.
export const deleteAdminReview = (userId, reviewId, type = 'service') =>
  request(`/admin/reviews/${type}/${reviewId}`, { method: 'DELETE', userId });

// Загружает заказы для панели администратора.
export const getAdminOrders = (userId) => request('/admin/orders', { userId });

// Изменяет статус заказа в панели администратора.
export const updateAdminOrderStatus = (userId, orderId, status) =>
  request(`/admin/orders/${orderId}/status`, { method: 'PATCH', body: { status }, userId });

// Подтверждает оплату заказа в панели администратора.
export const markAdminOrderPaid = (userId, orderId) =>
  request(`/admin/orders/${orderId}/payment`, { method: 'PATCH', body: {}, userId });

// Загружает записи на услуги для панели администратора.
export const getAdminAppointments = (userId) => request('/admin/appointments', { userId });

// Изменяет статус записи на услугу в панели администратора.
export const updateAdminAppointmentStatus = (userId, appointmentId, status) =>
  request(`/admin/appointments/${appointmentId}/status`, {
    method: 'PATCH',
    body: { status },
    userId,
  });

// Подтверждает оплату записи на услугу.
export const markAdminAppointmentPaid = (userId, appointmentId) =>
  request(`/admin/appointments/${appointmentId}/payment`, {
    method: 'PATCH',
    body: {},
    userId,
  });

// Создаёт отзыв об услуге.
export const saveServiceReview = (userId, serviceId, payload) =>
  request(`/services/${serviceId}/reviews`, { method: 'POST', body: payload, userId });

// Создаёт отзыв о товаре.
export const saveProductReview = (userId, productId, payload) =>
  request(`/products/${productId}/reviews`, { method: 'POST', body: payload, userId });

// Редактирует собственный отзыв.
export const updateMyReview = (userId, type, reviewId, payload) =>
  request(`/reviews/${type}/${reviewId}`, { method: 'PATCH', body: payload, userId });

// Удаляет собственный отзыв.
export const deleteMyReview = (userId, type, reviewId) =>
  request(`/reviews/${type}/${reviewId}`, { method: 'DELETE', userId });

// Загружает пользователей для панели администратора.
export const getUsers = (userId) => request('/users', { userId });

// Изменяет статус учётной записи клиента.
export const setUserStatus = (userId, targetUserId, is_active) =>
  request(`/users/${targetUserId}/status`, {
    method: 'PATCH',
    body: { is_active },
    userId,
  });

// Назначает персональный купон одному клиенту.
export const setUserDiscount = (userId, payload) =>
  request('/users/discount', { method: 'PATCH', body: payload, userId });

// Массово назначает персональный купон клиентам.
export const setUsersDiscount = (userId, payload) =>
  request('/users/discount/bulk', { method: 'PATCH', body: payload, userId });

// Настраивает скидки на выбранные товары для клиентов.
export const setClientProductDiscount = (userId, payload) =>
  request('/products/discount/bulk', { method: 'PATCH', body: payload, userId });

// Изменяет скидку товара или услуги в каталоге.
export const setCatalogDiscount = (userId, type, itemId, discount_percent) => {
  const resource = type === 'service' ? 'services' : 'products';
  return request(`/${resource}/${itemId}/discount`, {
    method: 'PATCH',
    body: { discount_percent },
    userId,
  });
};

// Переименовывает категорию каталога.
export const updateCategory = (userId, categoryId, name) =>
  request(`/categories/${categoryId}`, { method: 'PATCH', body: { name }, userId });

// Сохраняет изменения профиля пользователя.
export const updateProfile = (userId, payload) =>
  request('/profile', { method: 'PATCH', body: payload, userId });
