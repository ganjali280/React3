import { useState, useEffect } from 'react';
import './App.css';
import { AsideCategories } from './components/AsideCategories';
import { Products } from './components/Products';
import { ServiceCard } from './components/ServiceCard';
import { AuthModal } from './components/AuthModal';
import { CartModal } from './components/CartModal';
import { OrdersModal } from './components/OrdersModal';
import { AdminModal } from './components/AdminModal';
import {
  getServices,
  getProducts,
  getCategories,
  login,
  addCategory,
  checkout,
} from './api/client';

export default function App() {
  const [theme, setTheme] = useState("light");

  const toggleTheme = () => {
    setTheme(theme === "light" ? "dark" : "light");
  };

  const [services, setServices] = useState([]);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [cart, setCart] = useState([]);
  const [user, setUser] = useState(null);
  const [showAuth, setShowAuth] = useState(false);
  const [showCart, setShowCart] = useState(false);
  const [showOrders, setShowOrders] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadData = () => {
    setLoading(true);
    setError(null);
    Promise.all([getServices(), getProducts(), getCategories()])
      .then(([servicesData, productsData, categoriesData]) => {
        setServices(servicesData);
        setProducts(productsData);
        setCategories(categoriesData);
      })
      .catch((err) => {
        setError(err.message || 'Не удалось загрузить данные');
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleToggleCategory = (catId) => {
    setSelectedCategories((prev) =>
      prev.includes(catId) ? prev.filter((id) => id !== catId) : [...prev, catId]
    );
  };

  const handleAddCategory = async (name) => {
    try {
      const newCat = await addCategory(user.user_id, name);
      setCategories((prev) => [...prev, newCat]);
    } catch (err) {
      alert(err.message);
    }
  };

  const handleLogin = async (email, password) => {
    const data = await login(email, password);
    setUser(data);
  };

  const handleLogout = () => {
    setUser(null);
    setShowOrders(false);
    setShowAdmin(false);
  };

  const sameItem = (a, b) => a.type === b.type && a.id === b.id;

  const handleAddToCart = (item) => {
    setCart((prev) =>
      prev.some((c) => sameItem(c, item))
        ? prev.map((c) => (sameItem(c, item) ? { ...c, quantity: c.quantity + 1 } : c))
        : [...prev, { ...item, quantity: 1 }]
    );
  };

  const handleChangeQuantity = (item, delta) => {
    setCart((prev) =>
      prev.map((c) =>
        sameItem(c, item)
          ? { ...c, quantity: Math.min(100, Math.max(1, c.quantity + delta)) }
          : c
      )
    );
  };

  const handleRemoveFromCart = (item) => {
    setCart((prev) => prev.filter((c) => !sameItem(c, item)));
  };

  const handleCheckout = async () => {
    if (!user) {
      alert('Сначала войдите в систему');
      setShowAuth(true);
      return;
    }

    try {
      const result = await checkout(
        user.user_id,
        cart.map((c) => ({ type: c.type, id: c.id, quantity: c.quantity }))
      );
      alert(`${result.message} Сумма: ${result.total} ₽`);
      setCart([]);
      setShowCart(false);
    } catch (err) {
      alert(err.message);
    }
  };

  const byCategory = (item) =>
    selectedCategories.length === 0 || selectedCategories.includes(item.category_id);

  const filteredServices = services.filter(byCategory);
  const filteredProducts = products.filter(byCategory);
  const cartCount = cart.reduce((sum, c) => sum + c.quantity, 0);

  return (
    <div className={`app-shell ${theme === 'dark' ? 'theme-dark' : ''}`}>
      <header className="site-header">
        <div className="brand">Футбольный Экипировочный Центр</div>
        <div className="header-actions">
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title={theme === 'light' ? 'Тёмная тема' : 'Светлая тема'}
            aria-label="Переключить тему"
          >
            {theme === 'light' ? '◐' : '☼'}
          </button>
          <button className="button button-outline" onClick={() => setShowCart(true)}>
            Корзина ({cartCount})
          </button>
          {user ? (
            <div className="header-user">
              <span>{user.name}</span>
              {user.discount_percent > 0 && (
                <span className="user-coupon">
                  {user.discount_coupon} (-{user.discount_percent}%)
                </span>
              )}
              {user.role === 'admin' ? (
                <button className="button button-outline" onClick={() => setShowAdmin(true)}>
                  Админ-панель
                </button>
              ) : (
                <button className="button button-outline" onClick={() => setShowOrders(true)}>
                  Мои заказы
                </button>
              )}
              <button className="button button-outline" onClick={handleLogout}>
                Выйти
              </button>
            </div>
          ) : (
            <button className="button button-primary" onClick={() => setShowAuth(true)}>
              Войти
            </button>
          )}
        </div>
      </header>

      <main className="page-content">
        <div className="products-page">
          <div className="catalog-layout">
            <AsideCategories
              categories={categories}
              selectedCategories={selectedCategories}
              onToggleCategory={handleToggleCategory}
              onAddCategory={handleAddCategory}
              isAdmin={user?.role === 'admin'}
            />

            <div className="catalog-results">
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
                  <Products products={filteredProducts} onAddToCart={handleAddToCart} />

                  <section className="catalog-section">
                    <div className="section-heading">
                      <h2>Наши услуги</h2>
                    </div>
                    {filteredServices.length === 0 ? (
                      <p className="muted-copy">Услуг в выбранных категориях нет</p>
                    ) : (
                      <div className="product-grid">
                        {filteredServices.map((service) => (
                          <ServiceCard
                            key={service.service_id}
                            service={service}
                            onAddToCart={handleAddToCart}
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
      </main>

      <footer className="site-footer">
        Футбольный Экипировочный Центр — экипировка и услуги для игроков
      </footer>

      {showAuth && (
        <AuthModal onClose={() => setShowAuth(false)} onLogin={handleLogin} />
      )}

      {showCart && (
        <CartModal
          cart={cart}
          user={user}
          onClose={() => setShowCart(false)}
          onChangeQuantity={handleChangeQuantity}
          onRemoveItem={handleRemoveFromCart}
          onCheckout={handleCheckout}
        />
      )}

      {showOrders && user && (
        <OrdersModal user={user} onClose={() => setShowOrders(false)} />
      )}

      {showAdmin && user?.role === 'admin' && (
        <AdminModal
          admin={user}
          products={products}
          services={services}
          onClose={() => setShowAdmin(false)}
          onChanged={loadData}
        />
      )}
    </div>
  );
}
