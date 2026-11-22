import { useState, useEffect, useRef, useCallback } from 'react';
import {
  BrowserRouter,
  NavLink,
  Route,
  Routes,
  Link,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import './App.css';
import { AsideCategories } from './components/AsideCategories';
import { Products } from './components/Products';
import { ServiceCard } from './components/ServiceCard';
import { getServiceImage } from './components/serviceImages';
import { AuthPage } from './components/AuthPage';
import { PasswordResetPage } from './components/PasswordResetPage';
import { BackendOfflinePage } from './components/BackendOfflinePage';
import { OrdersPage } from './components/OrdersPage';
import { AdminModal } from './components/AdminModal';
import { CartProvider } from './components/CartContext';
import { useCart } from './components/useCart';
import { ThemeProvider } from './components/ThemeContext';
import { useTheme } from './components/useTheme';
import { containsProhibitedText, isValidFullName, isValidPhone } from './validation';
import {
  getServices,
  getProducts,
  getCategories,
  login,
  register as registerUser,
  getCurrentSession,
  logout,
  checkout,
  getCart,
  saveCart,
  updateProfile,
  getAvailableCoupons,
  validateCoupon,
  backendUnavailableEvent,
  checkBackendStatus,
  deleteCatalogItem,
} from './api/client';

// Футбольный Экипировочный Центр (ФЭЦ) — информационная система магазина.
const USER_STORAGE_KEY = 'fec-user';

// Загружает сохранённые в браузере данные пользователя.
const readStoredUser = () => {
  try {
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && Number.isInteger(parsed.user_id) ? parsed : null;
  } catch {
    return null;
  }
};

// Сохраняет данные пользователя или удаляет их из браузера.
const writeStoredUser = (user) => {
  try {
    if (user) {
      localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(USER_STORAGE_KEY);
    }
  } catch {
    return false;
  }
  return true;
};

// Подключает маршрутизатор и общие поставщики темы и корзины.
export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <CartProvider>
          <Storefront />
        </CartProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

// Оставляет в корзине доступные товары и добавляет изображения услуг.
const normalizeCartItems = (items) =>
  items
    .filter((item) => item.type !== 'product' || Number(item.stock_quantity) > 0)
    .map((item) => (
      item.type === 'service'
        ? { ...item, image_url: getServiceImage(item) }
        : item.type === 'product'
          ? { ...item, quantity: Math.min(item.quantity, Number(item.stock_quantity)) }
          : item
    ));

// Управляет навигацией, данными каталога, сессией пользователя и корзиной.
function Storefront() {
  const navigate = useNavigate();
  const location = useLocation();
  const backendOfflineRef = useRef(false);
  const connectionCheckRef = useRef(false);
  const offlineReturnPathRef = useRef('/');
  const { theme, toggleTheme } = useTheme();
  const { cart, addItem, changeQuantity, removeItem, clearCart, replaceCart } = useCart();
  const cartSyncPayload = JSON.stringify(
    cart.map(({ type, id, quantity }) => ({ type, id, quantity }))
  );
  const [services, setServices] = useState([]);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [user, setUser] = useState(null);
  const [sessionChecking, setSessionChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [backendMessage, setBackendMessage] = useState('');
  const [backendOffline, setBackendOffline] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  const [cartError, setCartError] = useState('');
  const [cartReadyUser, setCartReadyUser] = useState(null);

  // Загружает каталог и категории с сервера.
  const loadData = useCallback(async (userId = user?.user_id) => {
    setLoading(true);
    setError(null);
    try {
      const [servicesData, productsData, categoriesData] = await Promise.all([
        getServices(),
        getProducts(userId),
        getCategories(),
      ]);
      setServices(servicesData);
      setProducts(productsData);
      setCategories(categoriesData);
      return true;
    } catch (err) {
      setError(err.message || 'Не удалось загрузить данные');
      return false;
    } finally {
      setLoading(false);
    }
  }, [user?.user_id]);

  const activeUserId = user?.user_id;

  useEffect(() => {
    let active = true;
    getCurrentSession()
      .then((sessionUser) => {
        if (!active) return;
        if (!sessionUser && readStoredUser()) writeStoredUser(null);
        setUser(sessionUser);
      })
      .catch((sessionError) => {
        if (active) setError(sessionError.message || 'Не удалось проверить сессию');
      })
      .finally(() => {
        if (active) setSessionChecking(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    // Переводит сайт на страницу недоступного сервера и сбрасывает локальную сессию.
    const handleBackendUnavailable = (event) => {
      setBackendMessage(
        event?.detail || 'Backend или база данных недоступны. Проверьте запуск сервера.'
      );
      setBackendOffline(true);
      if (backendOfflineRef.current) return;
      if (location.pathname !== '/backend-offline') {
        offlineReturnPathRef.current = location.pathname;
      }
      backendOfflineRef.current = true;
      setUser(null);
      setCartReadyUser(null);
      clearCart();
      navigate('/backend-offline', {
        replace: true,
        state: { from: offlineReturnPathRef.current },
      });
    };

    // Возвращает пользователя на прежнюю страницу после восстановления сервера.
    const recoverBackend = () => {
      if (!backendOfflineRef.current) return;
      backendOfflineRef.current = false;
      setBackendOffline(false);
      const returnPath =
        location.pathname === '/backend-offline'
          ? location.state?.from || offlineReturnPathRef.current
          : location.pathname;
      navigate(returnPath, { replace: true });
    };

    // Проверяет доступность сервера и восстанавливает данные при подключении.
    const checkConnection = async () => {
      if (connectionCheckRef.current) return;
      connectionCheckRef.current = true;
      try {
        await checkBackendStatus();
        if (backendOfflineRef.current) {
          const sessionUser = await getCurrentSession();
          const loaded = await loadData(sessionUser?.user_id);
          if (!loaded) return;
          setUser(sessionUser);
          setBackendMessage('');
          recoverBackend();
        } else {
          setBackendMessage('');
        }
      } catch (requestError) {
        handleBackendUnavailable({ detail: requestError.message });
      } finally {
        connectionCheckRef.current = false;
      }
    };

    window.addEventListener(backendUnavailableEvent, handleBackendUnavailable);
    checkConnection();
    const intervalId = window.setInterval(checkConnection, 1000);
    return () => {
      window.removeEventListener(backendUnavailableEvent, handleBackendUnavailable);
      window.clearInterval(intervalId);
    };
  }, [clearCart, loadData, location.pathname, location.state, navigate]);

  useEffect(() => {
    let active = true;
    Promise.all([getServices(), getProducts(activeUserId), getCategories()])
      .then(([servicesData, productsData, categoriesData]) => {
        if (active) {
          setServices(servicesData);
          setProducts(productsData);
          setCategories(categoriesData);
        }
      })
      .catch((err) => {
        if (active) setError(err.message || 'Не удалось загрузить данные');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeUserId]);

  useEffect(() => {
    writeStoredUser(user);
  }, [user]);

  useEffect(() => {
    if (!activeUserId || user?.role === 'admin') return undefined;

    let active = true;
    getCart(activeUserId)
      .then((items) => {
        if (active) {
          replaceCart(normalizeCartItems(items));
          setCartError('');
          setCartReadyUser(activeUserId);
        }
      })
      .catch((err) => {
        if (active) setCartError(err.message || 'Не удалось загрузить корзину');
      });

    return () => {
      active = false;
    };
  }, [activeUserId, user?.role, replaceCart]);

  useEffect(() => {
    if (!user || user.role === 'admin' || cartReadyUser !== user.user_id) return undefined;
    let active = true;
    const items = JSON.parse(cartSyncPayload);
    const timer = setTimeout(() => {
      saveCart(user.user_id, items)
        .then(() => getCart(user.user_id))
        .then((savedItems) => {
          if (!active) return;
          replaceCart(normalizeCartItems(savedItems));
          setCartError('');
        })
        .catch((err) => {
          if (active) setCartError(err.message || 'Не удалось обновить корзину');
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [cartSyncPayload, user, cartReadyUser, replaceCart]);

  // Добавляет категорию в фильтр или убирает её из выбранных.
  const handleToggleCategory = (catId) => {
    setSelectedCategories((prev) =>
      prev.includes(catId) ? prev.filter((id) => id !== catId) : [...prev, catId]
    );
  };

  // Выполняет вход и загружает состояние учётной записи.
  const handleLogin = async (email, password) => {
    const data = await login(email, password);
    replaceCart([]);
    setCartReadyUser(null);
    setCartError('');
    setLoading(true);
    setError(null);
    setUser(data);
    navigate('/dashboard');
  };

  // Регистрирует пользователя и открывает его личный кабинет.
  const handleRegister = async (name, email, password, phone) => {
    const data = await registerUser(name, email, password, phone);
    replaceCart([]);
    setCartReadyUser(null);
    setCartError('');
    setLoading(true);
    setError(null);
    setUser(data);
    navigate('/dashboard');
  };

  // Завершает сессию и очищает данные пользователя и корзины.
  const handleLogout = async () => {
    try {
      await logout();
    } catch (logoutError) {
      setError(logoutError.message || 'Не удалось завершить серверную сессию');
    } finally {
      setUser(null);
      setCartReadyUser(null);
      setCartError('');
      setLoading(true);
      setError(null);
      clearCart();
      navigate('/');
    }
  };

  // Повторно подключается к серверу и восстанавливает страницу пользователя.
  const retryBackend = async () => {
    await checkBackendStatus();
    const sessionUser = await getCurrentSession();
    const loaded = await loadData(sessionUser?.user_id);
    if (!loaded) {
      throw new Error('Не удалось загрузить данные после запуска backend');
    }
    setUser(sessionUser);
    setBackendMessage('');
    backendOfflineRef.current = false;
    setBackendOffline(false);
    navigate(location.state?.from || offlineReturnPathRef.current, { replace: true });
  };

  // Проверяет возможность покупки и добавляет позицию в корзину.
  const handleAddToCart = (item) => {
    if (!user) {
      navigate('/login');
      return;
    }

    if (user.role === 'admin') return;

    if (item.type === 'product' && Number(item.stock_quantity) <= 0) {
      setCartError('Товар закончился на складе');
      return;
    }

    addItem(item);
    navigate('/cart');
  };

  // Удаляет позицию каталога от имени администратора.
  const handleDeleteCatalogItem = async (item, type) => {
    if (user?.role !== 'admin') return;
    if (!window.confirm(`Удалить «${item.name}» из каталога?`)) return;

    const itemId = type === 'product' ? item.product_id : item.service_id;
    try {
      await deleteCatalogItem(user.user_id, type, itemId);
      await loadData(user.user_id);
    } catch (deleteError) {
      setError(deleteError.message || 'Не удалось удалить позицию из каталога');
    }
  };

  // Отправляет корзину на оформление заказа и показывает результат.
  const handleCheckout = async ({ delivery_address, delivery_date, coupon_code }) => {
    if (!user) {
      navigate('/login');
      return;
    }

    setCheckoutError('');
    try {
      const result = await checkout(
        user.user_id,
        {
          items: cart.map((c) => ({ type: c.type, id: c.id, quantity: c.quantity })),
          delivery_address,
          delivery_date,
          coupon_code,
        }
      );
      setUser((current) =>
        current ? { ...current, default_address: delivery_address } : current
      );
      try {
        window.localStorage.removeItem(getCartCouponStorageKey(user.user_id));
      } catch (storageError) {
        console.error('Не удалось удалить сохранённый код купона:', storageError);
      }
      clearCart();
      setCartError('');
      navigate('/order-success', {
        state: {
          message: `${result.user_order_number ? `Заказ №${result.user_order_number}. ` : ''}${result.message} Сумма: ${result.total} ₽`,
        },
      });
    } catch (err) {
      setCheckoutError(err.message || 'Не удалось оформить заказ');
    }
  };

  // Проверяет, входит ли позиция в выбранные категории.
  const byCategory = (item) =>
    selectedCategories.length === 0 || selectedCategories.includes(item.category_id);
  // Проверяет соответствие позиции текстовому запросу и границам цены.
  const bySearchAndPrice = (item) => {
    const query = searchQuery.trim().toLocaleLowerCase('ru-RU');
    const matchesText =
      !query ||
      [item.name, item.description, item.category_name, item.product_id, item.service_id]
        .some((value) => String(value || '').toLocaleLowerCase('ru-RU').includes(query));
    const price = item.has_discount
      ? Math.round(Number(item.price) * (1 - Number(item.discount_percent) / 100))
      : Number(item.price);
    return (
      matchesText &&
      (minPrice === '' || price >= Number(minPrice)) &&
      (maxPrice === '' || price <= Number(maxPrice))
    );
  };

  const filteredServices = services.filter((item) => byCategory(item) && bySearchAndPrice(item));
  const filteredProducts = products.filter((item) => byCategory(item) && bySearchAndPrice(item));
  const cartCount = cart.reduce((sum, c) => sum + c.quantity, 0);

  if (backendOffline || location.pathname === '/backend-offline') {
    return (
      <div className={`app-shell backend-offline-shell ${theme === 'dark' ? 'theme-dark' : ''}`}>
        <main className="page-content backend-offline-content">
          <BackendOfflinePage onRetry={retryBackend} errorMessage={backendMessage} />
        </main>
      </div>
    );
  }

  return (
    <div className={`app-shell ${theme === 'dark' ? 'theme-dark' : ''}`}>
      <header className="site-header">
        <Link className="brand" to="/">Футбольный Экипировочный Центр</Link>
        <nav className="main-nav" aria-label="Основная навигация">
          <NavLink to="/" end>Каталог</NavLink>
          {user?.role !== 'admin' && (
            <NavLink to="/cart">Корзина ({cartCount})</NavLink>
          )}
          <NavLink to="/dashboard">Профиль</NavLink>
        </nav>
        <div className="header-actions">
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title={theme === 'light' ? 'Тёмная тема' : 'Светлая тема'}
            aria-label="Переключить тему"
          >
            {theme === 'light' ? '◐' : '☼'}
          </button>
          {user ? (
            <div className="header-user">
              <span>{user.name}</span>
              {user.role === 'admin' ? (
                <Link className="button button-outline" to="/admin">
                  Админ-панель
                </Link>
              ) : (
                <Link className="button button-outline" to="/orders">
                  Мои заказы
                </Link>
              )}
              <button className="button button-outline" onClick={handleLogout}>
                Выйти
              </button>
            </div>
          ) : (
            <Link className="button button-primary" to="/login">Войти</Link>
          )}
        </div>
      </header>

      <main className="page-content">
        <Routes>
          <Route
            path="/"
            element={
              <div className="products-page">
                <div className="catalog-layout">
                  <AsideCategories
                    categories={categories}
                    selectedCategories={selectedCategories}
                    onToggleCategory={handleToggleCategory}
                  />
                  <div className="catalog-results">
                    <div className="catalog-filters" role="search">
                      <label>
                        Поиск по услугам и товарам
                        <input
                          type="search"
                          value={searchQuery}
                          onChange={(event) => setSearchQuery(event.target.value)}
                          placeholder="Название, описание, категория или код позиции"
                        />
                      </label>
                      <label>
                        Цена от
                        <input
                          type="number"
                          min="0"
                          value={minPrice}
                          onChange={(event) => setMinPrice(event.target.value)}
                        />
                      </label>
                      <label>
                        Цена до
                        <input
                          type="number"
                          min="0"
                          value={maxPrice}
                          onChange={(event) => setMaxPrice(event.target.value)}
                        />
                      </label>
                    </div>
                    {loading && <p className="status-message">Загрузка данных...</p>}
                    {!loading && error && (
                      <div className="state-block error">
                        <div>Ошибка: {error}</div>
                        <button className="button button-outline" onClick={loadData}>
                          Попробовать снова
                        </button>
                      </div>
                    )}
                    {!loading && !error && (
                      <>
                        <Products
                          products={filteredProducts}
                          onAddToCart={handleAddToCart}
                          onDelete={handleDeleteCatalogItem}
                          isAuthenticated={Boolean(user)}
                          isAdmin={user?.role === 'admin'}
                          user={user}
                        />
                        <section className="catalog-section">
                          <div className="section-heading">
                            <h2>Наши услуги</h2>
                            <p className="catalog-count">Найдено: {filteredServices.length}</p>
                          </div>
                          {filteredServices.length === 0 ? (
                            <p className="muted-copy">По выбранным условиям услуг не найдено</p>
                          ) : (
                            <div className="product-grid service-grid">
                              {filteredServices.map((service) => (
                                <ServiceCard
                                  key={service.service_id}
                                  service={service}
                                  onAddToCart={handleAddToCart}
                                  onDelete={handleDeleteCatalogItem}
                                  isAuthenticated={Boolean(user)}
                                  isAdmin={user?.role === 'admin'}
                                  user={user}
                                />
                              ))}
                            </div>
                          )}
                        </section>
                      </>
                    )}
                  </div>
                </div>
              </div>
            }
          />
          <Route
            path="/cart"
            element={
              sessionChecking ? (
                <p className="status-message">Проверяем доступ к корзине…</p>
              ) : user?.role === 'admin' ? (
                <CartUnavailablePage />
              ) : (
                <CartPage
                  key={user?.user_id ?? 'anonymous'}
                  cart={cart}
                  user={user}
                  cartReady={Boolean(user && cartReadyUser === user.user_id)}
                  error={checkoutError || cartError}
                  onChangeQuantity={changeQuantity}
                  onRemoveItem={removeItem}
                  onCheckout={handleCheckout}
                />
              )
            }
          />
          <Route path="/order-success" element={<OrderSuccessPage />} />
          <Route
            path="/login"
            element={
              <AuthPage
                mode="login"
                onLogin={handleLogin}
                onRegister={handleRegister}
              />
            }
          />
          <Route
            path="/register"
            element={
              <AuthPage
                mode="register"
                onLogin={handleLogin}
                onRegister={handleRegister}
              />
            }
          />
          <Route path="/forgot-password" element={<PasswordResetPage />} />
          <Route
            path="/backend-offline"
            element={
              <BackendOfflinePage
                onRetry={retryBackend}
                errorMessage={backendMessage}
              />
            }
          />
          <Route
            path="/dashboard"
            element={
              <DashboardPage
                user={user}
                onSaveProfile={async (profile) => {
                  const updated = await updateProfile(user.user_id, profile);
                  setUser(updated);
                }}
                onAdmin={() => navigate('/admin')}
                onBrowse={() => navigate('/')}
              />
            }
          />
          <Route path="/orders" element={<OrdersPage user={user} />} />
          <Route
            path="/admin"
            element={
              sessionChecking ? (
                <p className="status-message">Проверяем права доступа…</p>
              ) : user?.role === 'admin' ? (
                <AdminModal
                  admin={user}
                  products={products}
                  services={services}
                  categories={categories}
                  standalone
                  onClose={() => navigate('/dashboard')}
                  onChanged={loadData}
                />
              ) : (
                <AccessDeniedPage user={user} />
              )
            }
          />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>

      <footer className="site-footer">
        Футбольный Экипировочный Центр — экипировка и услуги для игроков
      </footer>

    </div>
  );
}

// Формирует ключ сохранённого купона для конкретного пользователя.
const getCartCouponStorageKey = (userId) => `fec:cart-coupon:${userId}`;

// Загружает из браузера ранее сохранённый код купона.
const readSavedCartCoupon = (userId) => {
  if (!userId) return { code: '', error: '' };
  try {
    return {
      code: window.localStorage.getItem(getCartCouponStorageKey(userId)) || '',
      error: '',
    };
  } catch {
    return { code: '', error: 'Не удалось восстановить купон из браузера' };
  }
};

// Показывает состав корзины, проверяет доставку и оформляет заказ.
function CartPage({ cart, user, cartReady, error, onChangeQuantity, onRemoveItem, onCheckout }) {
  const [savedCoupon, setSavedCoupon] = useState(() => ({
    userId: user?.user_id ?? null,
    ...readSavedCartCoupon(user?.user_id),
  }));
  const [couponCode, setCouponCode] = useState(() => savedCoupon.code);
  const [address, setAddress] = useState(user?.default_address || '');
  const [addressError, setAddressError] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [couponError, setCouponError] = useState(() => savedCoupon.error);
  const [couponMessage, setCouponMessage] = useState('');
  const [applyingCoupon, setApplyingCoupon] = useState(false);
  const [availableCoupons, setAvailableCoupons] = useState([]);
  const [availableCouponsError, setAvailableCouponsError] = useState('');
  const [loadingAvailableCoupons, setLoadingAvailableCoupons] = useState(Boolean(user?.user_id));
  const [submitting, setSubmitting] = useState(false);
  const [deliveryDate, setDeliveryDate] = useState(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  });
  const cartSignature = cart
    .map((item) => `${item.type}:${item.id}:${item.quantity}:${item.price}:${item.finalPrice}:${item.discount_percent}`)
    .join('|');
  const activeCoupon = appliedCoupon?.cartSignature === cartSignature ? appliedCoupon : null;
  const couponStorageKey = user?.user_id
    ? getCartCouponStorageKey(user.user_id)
    : '';
  const today = new Date();
  const minDeliveryDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const discount = Number(activeCoupon?.percent) || 0;
  const originalSubtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const calculatedTotal = cart.reduce(
    (sum, item) => sum + Math.round(item.finalPrice * item.quantity * (1 - discount / 100)),
    0
  );
  const total = activeCoupon ? activeCoupon.total : calculatedTotal;
  const totalDiscount = originalSubtotal - total;
  const totalDiscountPercent = originalSubtotal > 0
    ? Math.round((totalDiscount / originalSubtotal) * 100)
    : 0;

  useEffect(() => {
    if (!user?.user_id) return undefined;

    let active = true;
    getAvailableCoupons()
      .then((coupons) => {
        if (active) setAvailableCoupons(coupons);
      })
      .catch((requestError) => {
        if (active) {
          setAvailableCouponsError(requestError.message || 'Не удалось загрузить доступные купоны');
        }
      })
      .finally(() => {
        if (active) setLoadingAvailableCoupons(false);
      });

    return () => {
      active = false;
    };
  }, [user?.user_id]);

  useEffect(() => {
    if (
      !cartReady ||
      !user?.user_id ||
      savedCoupon.userId !== user.user_id ||
      !savedCoupon.code ||
      couponCode.trim() !== savedCoupon.code ||
      cart.length === 0
    ) {
      return undefined;
    }

    let active = true;
    const restoredCartSignature = cartSignature;
    validateCoupon(user.user_id, {
      code: savedCoupon.code,
      items: cart.map(({ type, id, quantity }) => ({ type, id, quantity })),
    })
      .then((result) => {
        if (!active) return;
        setAppliedCoupon({ ...result, cartSignature: restoredCartSignature });
        setCouponError('');
        setSavedCoupon({ userId: user.user_id, code: '' });
      })
      .catch((requestError) => {
        if (!active) return;
        setAppliedCoupon(null);
        setCouponCode('');
        setSavedCoupon({ userId: user.user_id, code: '' });
        setCouponError(requestError.message || 'Не удалось восстановить купон');
      });

    return () => {
      active = false;
    };
  }, [
    cart,
    cartReady,
    cartSignature,
    couponCode,
    couponStorageKey,
    savedCoupon.code,
    savedCoupon.userId,
    user?.user_id,
  ]);

  // Проверяет купон для текущего состава корзины и сохраняет его.
  const applyCoupon = async (event, selectedCode) => {
    event?.preventDefault();
    const code = (selectedCode || couponCode).trim().toUpperCase();
    if (activeCoupon && activeCoupon.code.toUpperCase() === code) {
      setCouponError('');
      setCouponMessage('Купон уже применён');
      return;
    }

    const validatedCartSignature = cartSignature;
    setCouponError('');
    setCouponMessage('');
    setApplyingCoupon(true);
    setCouponCode(code);
    setSavedCoupon({ userId: user.user_id, code: '' });
    try {
      const result = await validateCoupon(user.user_id, {
        code,
        items: cart.map(({ type, id, quantity }) => ({ type, id, quantity })),
      });
      setAppliedCoupon({ ...result, cartSignature: validatedCartSignature });
      setCouponCode(code);
      try {
        window.localStorage.setItem(couponStorageKey, code);
      } catch {
        setCouponError('Купон применён, но его не удалось сохранить для следующей загрузки страницы');
      }
    } catch (requestError) {
      setAppliedCoupon(null);
      try {
        window.localStorage.removeItem(couponStorageKey);
        setCouponError(requestError.message || 'Не удалось применить купон');
      } catch {
        setCouponError('Не удалось применить купон и удалить сохранённый код');
      }
    } finally {
      setApplyingCoupon(false);
    }
  };

  return (
    <section className="cart-page">
      <div className="section-heading">
        <h1>Корзина</h1>
        <p>Проверьте товары перед оформлением заказа.</p>
      </div>
      {error && <p className="form-error" role="alert">{error}</p>}
      {cart.length === 0 ? (
        <div className="empty-state">
          <p className="eyebrow">ВАША ПОКУПКА</p>
          <h1>Корзина пуста</h1>
          <p>Добавьте товары или услуги из каталога, чтобы продолжить.</p>
          <Link className="button button-primary" to="/">Перейти в каталог</Link>
        </div>
      ) : (
        <>
          <ul className="cart-list cart-page-list">
            {cart.map((item) => (
              <li className="cart-row" key={`${item.type}-${item.id}`}>
                {item.image_url ? (
                  <img className="cart-item-image" src={item.image_url} alt={item.name} />
                ) : (
                  <div className="cart-item-image cart-image-placeholder">
                    {item.type === 'service' ? 'Услуга' : 'Товар'}
                  </div>
                )}
                <div className="cart-item-info">
                  <span className="cart-item-name">{item.name}</span>
                  <span className="cart-item-unit-price">
                    {item.price > item.finalPrice && <s>{item.price} ₽ · </s>}
                    {item.finalPrice} ₽ за шт.
                  </span>
                  {Number(item.discount_percent) > 0 && (
                    <span className="cart-item-discounted-price">
                      Скидка {item.discount_percent}%
                    </span>
                  )}
                  {discount > 0 && (
                    <span className="cart-item-discounted-price">
                      После купона ({discount}%): {Math.round(item.finalPrice * (1 - discount / 100))} ₽ за шт.
                    </span>
                  )}
                </div>
                <div className="quantity-control cart-quantity-control">
                  <button
                    aria-label={`Уменьшить количество: ${item.name}`}
                    onClick={() => onChangeQuantity(item, -1)}
                    disabled={item.quantity <= 1}
                  >−</button>
                  <span className="cart-quantity-value">{item.quantity}</span>
                  <button
                    aria-label={`Увеличить количество: ${item.name}`}
                    onClick={() => onChangeQuantity(item, 1)}
                    disabled={item.quantity >= (item.type === 'product' ? Number(item.stock_quantity) || 0 : 100)}
                  >+</button>
                </div>
                <strong className="cart-line-total">
                  {discount > 0 && <s>{item.finalPrice * item.quantity} ₽</s>}
                  {' '}{Math.round(item.finalPrice * item.quantity * (1 - discount / 100))} ₽
                </strong>
                <button
                  className="text-button cart-remove-button"
                  onClick={() => onRemoveItem(item)}
                >Удалить</button>
              </li>
            ))}
            <li className="cart-total">
              <div className="cart-total-summary">
                <span>Сумма до скидки: {originalSubtotal} ₽</span>
                <span className="cart-discount-total">
                  Скидка: −{totalDiscount} ₽ ({totalDiscountPercent}%)
                </span>
                {discount > 0 && (
                  <p className="coupon-total">
                    Купон {activeCoupon.code}: {discount}% (−{activeCoupon.discount} ₽)
                  </p>
                )}
                <strong>К оплате: {total} ₽</strong>
              </div>
            </li>
          </ul>
          <section className="available-coupons" aria-labelledby="available-coupons-title">
            <h2 id="available-coupons-title">Доступные купоны</h2>
            {loadingAvailableCoupons && <p className="muted-copy">Загружаем купоны…</p>}
            {availableCouponsError && (
              <p className="form-error" role="alert">{availableCouponsError}</p>
            )}
            {!user?.user_id && (
              <p className="muted-copy">Войдите в аккаунт, чтобы увидеть доступные купоны.</p>
            )}
            {!loadingAvailableCoupons && !availableCouponsError && user?.user_id && (
              availableCoupons.length > 0 ? (
                <ul className="available-coupon-list">
                  {availableCoupons.map((coupon) => (
                    <li className="available-coupon" key={coupon.coupon_id}>
                      <div>
                        <strong>{coupon.code} · −{coupon.percent}%</strong>
                        <small>
                          {coupon.audience === 'personal' ? 'Назначен вам' : 'Доступен всем'} ·{' '}
                          {coupon.usage_type === 'one_time'
                            ? coupon.audience === 'personal'
                              ? '1 применение на клиента'
                              : 'одно применение всего'
                            : 'многоразовый'}
                        </small>
                        {Number(coupon.min_order) > 0 && (
                          <small>Минимальный заказ: {coupon.min_order} ₽</small>
                        )}
                        {coupon.expires_at && (
                          <small>
                            Действует до {new Date(coupon.expires_at).toLocaleString('ru-RU')}
                          </small>
                        )}
                      </div>
                      <button
                        type="button"
                        className="text-button"
                        disabled={applyingCoupon}
                        onClick={() => applyCoupon(null, coupon.code)}
                      >
                        Применить
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted-copy">У вас пока нет доступных купонов.</p>
              )
            )}
          </section>
          <form className="coupon-entry-form" onSubmit={applyCoupon}>
            <label>
              Код купона
              <input
                type="text"
                value={couponCode}
                onChange={(event) => {
                  setCouponCode(event.target.value);
                  setCouponMessage('');
                }}
                maxLength={50}
                placeholder="Введите код купона"
                aria-invalid={Boolean(couponError)}
                aria-describedby={couponError ? 'checkout-coupon-error' : undefined}
              />
              {couponError && (
                <small className="field-error" id="checkout-coupon-error" role="alert">
                  {couponError}
                </small>
              )}
            </label>
            <button
              className="button button-outline"
              type="submit"
              disabled={applyingCoupon || !couponCode.trim()}
            >
              {applyingCoupon ? 'Проверяем…' : 'Применить купон'}
            </button>
            {activeCoupon && (
              <button
                className="text-button"
                type="button"
                onClick={() => {
                  setAppliedCoupon(null);
                  setCouponMessage('');
                }}
              >
                Убрать купон
              </button>
            )}
          </form>
          {couponMessage && <p className="success-message" role="status">{couponMessage}</p>}
          <form
            className="checkout-form"
            onSubmit={async (event) => {
              event.preventDefault();
              if (containsProhibitedText(address)) {
                setAddressError('Адрес содержит недопустимые слова');
                return;
              }
              setAddressError('');
              setSubmitting(true);
              try {
                await onCheckout({
                  delivery_address: address.trim(),
                  delivery_date: deliveryDate,
                  coupon_code: activeCoupon?.code || '',
                });
              } finally {
                setSubmitting(false);
              }
            }}
          >
            <p className="checkout-payment-note">
              Оплата наличными или картой при получении заказа или оказании услуги.
            </p>
            <label>
              Адрес доставки
              <textarea
                value={address}
                onChange={(event) => {
                  setAddress(event.target.value);
                  setAddressError('');
                }}
                maxLength={500}
                required
              />
              {addressError && <span className="field-error" role="alert">{addressError}</span>}
            </label>
            <label>
              Дата доставки
              <input
                type="date"
                min={minDeliveryDate}
                value={deliveryDate}
                onChange={(event) => setDeliveryDate(event.target.value)}
                required
              />
            </label>
            <button className="button button-primary checkout-button" type="submit" disabled={submitting}>
              {submitting ? 'Оформляем…' : 'Оформить заказ'}
            </button>
          </form>
          <button className="button button-outline receipt-print" onClick={() => window.print()}>
            Печать чека
          </button>
        </>
      )}
    </section>
  );
}

// Показывает подтверждение оформления заказа.
function OrderSuccessPage() {
  const { state } = useLocation();

  return (
    <section className="cart-page">
      <div className="empty-state" role="status">
        <p className="eyebrow">ЗАКАЗ</p>
        <h1>Спасибо за заказ!</h1>
        <p className="success-message">
          {state?.message || 'Информация о результате заказа недоступна.'}
        </p>
        <Link className="button button-primary" to="/">Вернуться в каталог</Link>
      </div>
    </section>
  );
}

// Отображает личный кабинет, настройки профиля и историю заказов.
function DashboardPage({ user, onAdmin, onBrowse, onSaveProfile }) {
  if (!user) {
    return (
      <section className="dashboard-page">
        <div className="empty-state">
          <p className="eyebrow">ЛИЧНЫЙ КАБИНЕТ</p>
          <h1>Войдите в профиль</h1>
          <p>После входа вы сможете просматривать заказы и данные аккаунта.</p>
          <Link className="button button-primary" to="/login">Войти</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="dashboard-page">
      <ProfileSettings user={user} onSave={onSaveProfile} onAdmin={onAdmin} onBrowse={onBrowse} />
      <OrdersPage user={user} embedded />
    </section>
  );
}

// Загружает данные профиля и сохраняет изменения через сервер.
function ProfileSettings({ user, onSave, onAdmin, onBrowse }) {
  const [form, setForm] = useState({
    name: user.name || '',
    email: user.email || '',
    phone: user.phone || '',
    default_address: user.default_address || '',
    current_password: '',
    new_password: '',
  });
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  // Обновляет поле профиля и сбрасывает связанную ошибку.
  const updateField = (event) => {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    setFieldErrors((current) => ({ ...current, [name]: '' }));
    setError('');
  };
  // Возвращает сообщение об ошибке для поля профиля.
  const fieldError = (field) => fieldErrors[field] && (
    <span className="field-error" id={`profile-${field}-error`} role="alert">
      {fieldErrors[field]}
    </span>
  );
  // Проверяет и сохраняет изменения профиля.
  const save = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    const nextFieldErrors = {};
    if (!isValidFullName(form.name)) {
      nextFieldErrors.name = 'Введите имя и фамилию';
    } else if (containsProhibitedText(form.name)) {
      nextFieldErrors.name = 'Имя содержит недопустимые слова';
    }
    if (containsProhibitedText(form.email)) {
      nextFieldErrors.email = 'Email содержит недопустимые слова';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      nextFieldErrors.email = 'Укажите корректный email';
    }
    if (!isValidPhone(form.phone)) {
      nextFieldErrors.phone = 'Укажите номер длиной от 10 до 15 цифр';
    }
    if (containsProhibitedText(form.default_address)) {
      nextFieldErrors.default_address = 'Адрес содержит недопустимые слова';
    }
    if (form.current_password && !form.new_password) {
      nextFieldErrors.new_password = 'Введите новый пароль';
    } else if (form.new_password && !form.current_password) {
      nextFieldErrors.current_password = 'Введите текущий пароль';
    } else if (form.new_password && form.new_password.length < 8) {
      nextFieldErrors.new_password = 'Новый пароль должен содержать не менее 8 символов';
    } else if (form.new_password && form.new_password.length > 128) {
      nextFieldErrors.new_password = 'Новый пароль не должен превышать 128 символов';
    }
    setFieldErrors(nextFieldErrors);
    if (Object.keys(nextFieldErrors).length > 0) {
      return;
    }
    setSaving(true);
    try {
      await onSave(form);
      setForm((current) => ({ ...current, current_password: '', new_password: '' }));
      setMessage('Данные профиля сохранены');
    } catch (requestError) {
      const requestMessage = requestError.message || 'Не удалось сохранить профиль';
      const normalizedMessage = requestMessage.toLocaleLowerCase('ru-RU');
      if (normalizedMessage.includes('email')) {
        setFieldErrors({ email: requestMessage });
      } else if (normalizedMessage.includes('телефон') || normalizedMessage.includes('номер')) {
        setFieldErrors({ phone: requestMessage });
      } else if (normalizedMessage.includes('имя') || normalizedMessage.includes('фио')) {
        setFieldErrors({ name: requestMessage });
      } else if (normalizedMessage.includes('адрес')) {
        setFieldErrors({ default_address: requestMessage });
      } else if (normalizedMessage.includes('пароль')) {
        setFieldErrors({
          [normalizedMessage.includes('текущий') ? 'current_password' : 'new_password']: requestMessage,
        });
      } else {
        setError(requestMessage);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="profile-card">
      <p className="eyebrow">ЛИЧНЫЙ КАБИНЕТ</p>
      <div className="profile-avatar" aria-hidden="true">{user.name?.charAt(0).toUpperCase()}</div>
      <h1>{user.name}</h1>
      <p className="role-label">Роль: {user.role === 'admin' ? 'администратор' : 'покупатель'}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="success-message" role="status">{message}</p>}
      <form className="profile-form" onSubmit={save} noValidate>
        <section className="profile-form-section">
          <div className="profile-form-section-heading">
            <h2>Контактные данные</h2>
            <p>Информация для связи и оформления заказов</p>
          </div>
          <div className="profile-details-grid">
            <label>
              ФИО
              <input name="name" value={form.name} onChange={updateField} maxLength={100} required aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? 'profile-name-error' : undefined} />
              {fieldError('name')}
            </label>
            <label>
              Email
              <input name="email" type="email" value={form.email} onChange={updateField} maxLength={100} required aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? 'profile-email-error' : undefined} />
              {fieldError('email')}
            </label>
            <label>
              Телефон
              <input name="phone" type="tel" value={form.phone} onChange={updateField} maxLength={30} aria-invalid={Boolean(fieldErrors.phone)} aria-describedby={fieldErrors.phone ? 'profile-phone-error' : undefined} />
              {fieldError('phone')}
            </label>
            <label className="profile-detail-wide">
              Адрес по умолчанию
              <textarea name="default_address" value={form.default_address} onChange={updateField} maxLength={500} aria-invalid={Boolean(fieldErrors.default_address)} aria-describedby={fieldErrors.default_address ? 'profile-default_address-error' : undefined} />
              {fieldError('default_address')}
            </label>
          </div>
        </section>
        <section className="profile-form-section">
          <div className="profile-form-section-heading">
            <h2>Смена пароля</h2>
            <p>Оставьте поля пустыми, если не хотите менять пароль</p>
          </div>
          <div className="profile-details-grid">
            <label>
              Текущий пароль
              <input name="current_password" type="password" autoComplete="current-password" value={form.current_password} onChange={updateField} aria-invalid={Boolean(fieldErrors.current_password)} aria-describedby={fieldErrors.current_password ? 'profile-current_password-error' : undefined} />
              {fieldError('current_password')}
            </label>
            <label>
              Новый пароль
              <input name="new_password" type="password" autoComplete="new-password" minLength={8} maxLength={128} value={form.new_password} onChange={updateField} aria-invalid={Boolean(fieldErrors.new_password)} aria-describedby={fieldErrors.new_password ? 'profile-new_password-error' : undefined} />
              {fieldError('new_password')}
              <small>Не менее 8 символов</small>
            </label>
          </div>
        </section>
        <button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Сохранение…' : 'Сохранить профиль'}</button>
      </form>
      <div className="profile-actions">
        {user.role === 'admin' ? (
          <button className="button button-outline" onClick={onAdmin}>Админ-панель</button>
        ) : (
          <a className="button button-outline" href="#orders-history">К истории заказов</a>
        )}
        <button className="button button-outline" onClick={onBrowse}>Перейти в каталог</button>
      </div>
    </div>
  );
}

// Показывает страницу для неизвестного адреса.
function NotFoundPage() {
  return (
    <section className="empty-state">
      <h1>Страница не найдена</h1>
      <Link className="button button-primary" to="/">На главную</Link>
    </section>
  );
}

// Сообщает об отсутствии доступа к выбранному разделу.
function AccessDeniedPage({ user }) {
  return (
    <section className="empty-state">
      <p className="eyebrow">ДОСТУП ЗАПРЕЩЁН</p>
      <h1>У вас нет прав</h1>
      <p>Административная панель доступна только администраторам.</p>
      <Link className="button button-primary" to={user ? '/' : '/login'}>
        {user ? 'На главную' : 'Войти в аккаунт'}
      </Link>
    </section>
  );
}

// Сообщает, что корзина доступна только вошедшему покупателю.
function CartUnavailablePage() {
  return (
    <section className="empty-state">
      <p className="eyebrow">КОРЗИНА НЕДОСТУПНА</p>
      <h1>Корзина недоступна</h1>
      <p>Администраторы не могут пользоваться корзиной.</p>
      <Link className="button button-primary" to="/">Вернуться в каталог</Link>
    </section>
  );
}
