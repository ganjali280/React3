import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  addCategory,
  deleteCategory,
  getCoupons,
  getAdminCoupons,
  getUsers,
  setCatalogDiscount,
  setClientProductDiscount,
  setUserDiscount,
  setUserStatus,
  setUsersDiscount,
  updateCategory,
} from '../api/client';
import { AdminCatalogManager } from './AdminCatalogManager';
import { AdminReviewManager } from './AdminReviewManager';
import { AdminOrderManager } from './AdminOrderManager';
import { AdminCouponManager } from './AdminCouponManager';
import { containsProhibitedText } from '../validation';

// Собирает инструменты администрирования каталога, клиентов, заказов и купонов.
export const AdminModal = ({
  admin,
  products,
  services,
  categories,
  onClose,
  onChanged,
  standalone = false,
}) => {
  const [users, setUsers] = useState([]);
  const [coupons, setCoupons] = useState([]);
  const [adminCoupons, setAdminCoupons] = useState([]);
  const [loadingAdminData, setLoadingAdminData] = useState(true);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [adminSearch, setAdminSearch] = useState('');
  const [userSearch, setUserSearch] = useState('');
  const [discountProductSearch, setDiscountProductSearch] = useState('');
  const [categorySearch, setCategorySearch] = useState('');
  const [activeSection, setActiveSection] = useState('catalog');
  const [newCategory, setNewCategory] = useState('');
  const [newCategoryError, setNewCategoryError] = useState('');
  const [discountItemType, setDiscountItemType] = useState('product');
  const [discountItemId, setDiscountItemId] = useState('');
  const [catalogDiscountPercent, setCatalogDiscountPercent] = useState('0');

  const [selectedProductIds, setSelectedProductIds] = useState([]);
  const [productDiscountUserIds, setProductDiscountUserIds] = useState([]);
  const [productDiscountPercent, setProductDiscountPercent] = useState('10');

  const [selectedUserIds, setSelectedUserIds] = useState([]);
  const [coupon, setCoupon] = useState('');
  const [couponPercent, setCouponPercent] = useState('10');
  const [bulkCouponFieldErrors, setBulkCouponFieldErrors] = useState({});
  const [singleCouponFieldErrors, setSingleCouponFieldErrors] = useState({});
  const [couponEditorClient, setCouponEditorClient] = useState(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      getUsers(admin.user_id),
      getCoupons(admin.user_id),
      getAdminCoupons(admin.user_id),
    ])
      .then(([userList, couponList, adminCouponList]) => {
        if (active) {
          setUsers(userList);
          setCoupons(couponList);
          setAdminCoupons(adminCouponList);
        }
      })
      .catch((err) => {
        if (active) setError(err.message || 'Не удалось загрузить данные админ-панели');
      })
      .finally(() => {
        if (active) setLoadingAdminData(false);
      });
    return () => {
      active = false;
    };
  }, [admin.user_id]);

  // Обновляет список управляемых купонов после изменений.
  const refreshAdminCoupons = async () => {
    setAdminCoupons(await getAdminCoupons(admin.user_id));
  };

  // Выполняет административное действие и показывает его результат.
  const run = async (action, okText) => {
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(okText);
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  };

  // Массово назначает выбранным пользователям купон со скидкой.
  const handleUserDiscount = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setBulkCouponFieldErrors({});
    const percent = Number(couponPercent);
    if (!Number.isInteger(percent) || percent < 0 || percent > 99) {
      setBulkCouponFieldErrors({ percent: 'Укажите целое число от 0 до 99%' });
      return;
    }
    if (containsProhibitedText(coupon)) {
      setBulkCouponFieldErrors({ code: 'Код купона содержит недопустимые слова' });
      return;
    }
    if (percent > 0 && (!coupon.trim() || coupon.trim().length > 50)) {
      setBulkCouponFieldErrors({ code: 'Укажите код купона длиной до 50 символов' });
      return;
    }
    if (selectedUserIds.length === 0) {
      setBulkCouponFieldErrors({ users: 'Выберите хотя бы одного клиента' });
      return;
    }

    try {
      await setUsersDiscount(admin.user_id, {
        user_ids: selectedUserIds,
        discount_coupon: coupon.trim(),
        discount_percent: percent,
      });
      setUsers(await getUsers(admin.user_id));
      setCoupons(await getCoupons(admin.user_id));
      setMessage(`Купон обновлён для выбранных клиентов (${selectedUserIds.length})`);
    } catch (requestError) {
      const errorText = requestError.message || 'Не удалось назначить купон';
      if (errorText.toLocaleLowerCase('ru-RU').includes('клиент')) {
        setBulkCouponFieldErrors({ users: errorText });
      } else if (errorText.toLocaleLowerCase('ru-RU').includes('код купона') ||
                 errorText.toLocaleLowerCase('ru-RU').includes('купона')) {
        setBulkCouponFieldErrors({ code: errorText });
      } else if (errorText.toLocaleLowerCase('ru-RU').includes('скидк')) {
        setBulkCouponFieldErrors({ percent: errorText });
      } else {
        setError(errorText);
      }
    }
  };

  // Назначает или изменяет купон для одного пользователя.
  const handleSingleUserDiscount = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setSingleCouponFieldErrors({});
    const percent = Number(couponPercent);
    if (!Number.isInteger(percent) || percent < 0 || percent > 99) {
      setSingleCouponFieldErrors({ percent: 'Укажите целое число от 0 до 99%' });
      return;
    }
    if (containsProhibitedText(coupon)) {
      setSingleCouponFieldErrors({ code: 'Код купона содержит недопустимые слова' });
      return;
    }
    if (percent > 0 && (!coupon.trim() || coupon.trim().length > 50)) {
      setSingleCouponFieldErrors({ code: 'Укажите код купона длиной до 50 символов' });
      return;
    }

    try {
      await setUserDiscount(admin.user_id, {
        email: couponEditorClient.email,
        discount_coupon: coupon.trim(),
        discount_percent: percent,
      });
      setUsers(await getUsers(admin.user_id));
      setCoupons(await getCoupons(admin.user_id));
      setMessage(`Купон обновлён для ${couponEditorClient.name}`);
      setCouponEditorClient(null);
    } catch (requestError) {
      const errorText = requestError.message || 'Не удалось сохранить купон';
      if (errorText.toLocaleLowerCase('ru-RU').includes('код купона') ||
          errorText.toLocaleLowerCase('ru-RU').includes('купона')) {
        setSingleCouponFieldErrors({ code: errorText });
      } else if (errorText.toLocaleLowerCase('ru-RU').includes('скидк')) {
        setSingleCouponFieldErrors({ percent: errorText });
      } else {
        setError(errorText);
      }
    }
  };

  // Открывает форму управления купоном выбранного пользователя.
  const openUserCouponEditor = (client) => {
    setError('');
    setMessage('');
    setCoupon(client.discount_coupon || '');
    setCouponPercent(client.discount_coupon ? String(client.discount_percent) : '10');
    setSingleCouponFieldErrors({});
    setCouponEditorClient(client);
  };

  // Блокирует или разблокирует учётную запись пользователя.
  const handleUserStatus = async (targetUser) => {
    const nextStatus = !targetUser.is_active;
    const confirmed = window.confirm(
      `${nextStatus ? 'Разблокировать' : 'Заблокировать'} пользователя ${targetUser.name}?`
    );
    if (!confirmed) return;
    const success = await run(
      () => setUserStatus(admin.user_id, targetUser.user_id, nextStatus),
      nextStatus ? 'Пользователь разблокирован' : 'Пользователь заблокирован'
    );
    if (success) setUsers(await getUsers(admin.user_id));
  };

  // Назначает скидку на выбранные товары конкретным клиентам.
  const handleClientProductDiscount = (e) => {
    e.preventDefault();
    if (selectedProductIds.length === 0 || productDiscountUserIds.length === 0) {
      setMessage('');
      setError('Выберите хотя бы один товар и одного клиента');
      return;
    }

    run(async () => {
      await setClientProductDiscount(admin.user_id, {
        product_ids: selectedProductIds,
        user_ids: productDiscountUserIds,
        discount_percent: Number(productDiscountPercent),
      });
      onChanged();
    }, `Скидка сохранена для ${selectedProductIds.length} товаров и ${productDiscountUserIds.length} клиентов`);
  };

  const discountItems = discountItemType === 'service' ? services : products;
  // Устанавливает скидку для выбранного товара или услуги.
  const handleCatalogDiscount = (event) => {
    event.preventDefault();
    if (!discountItemId) {
      setError('Выберите товар или услугу');
      return;
    }
    run(async () => {
      await setCatalogDiscount(
        admin.user_id,
        discountItemType,
        Number(discountItemId),
        Number(catalogDiscountPercent)
      );
      onChanged();
    }, 'Скидка для каталога сохранена');
  };

  const query = adminSearch.trim().toLocaleLowerCase('ru-RU');
  const allClients = users.filter((user) => user.role === 'client');
  const clients = allClients.filter((user) => {
    return !query || [user.name, user.email, user.discount_coupon]
      .some((value) => String(value || '').toLocaleLowerCase('ru-RU').includes(query));
  });
  const userQuery = userSearch.trim().toLocaleLowerCase('ru-RU');
  const visibleUsers = users.filter((user) =>
    !userQuery ||
    [user.name, user.email]
      .some((value) => String(value || '').toLocaleLowerCase('ru-RU').includes(userQuery))
  );
  const discountProductQuery = discountProductSearch.trim().toLocaleLowerCase('ru-RU');
  const visibleDiscountProducts = products.filter((product) =>
    !discountProductQuery ||
    product.name.toLocaleLowerCase('ru-RU').includes(discountProductQuery)
  );
  const normalizedCategorySearch = categorySearch.trim().toLocaleLowerCase('ru-RU');
  const visibleCategories = categories.filter((category) =>
    !normalizedCategorySearch ||
    category.name.toLocaleLowerCase('ru-RU').includes(normalizedCategorySearch)
  );

  // Проверяет название и создаёт новую категорию.
  const handleAddCategory = async (event) => {
    event.preventDefault();
    const name = newCategory.trim();
    setNewCategoryError('');
    if (!name) {
      setError('Введите название категории');
      return;
    }
    if (containsProhibitedText(name)) {
      setError('Название категории содержит недопустимые слова');
      return;
    }
    const normalizedName = name.toLocaleLowerCase('ru-RU');
    if (categories.some((category) =>
      category.name.trim().toLocaleLowerCase('ru-RU') === normalizedName
    )) {
      setError('');
      setNewCategoryError('Категория с таким названием уже существует');
      return;
    }

    setError('');
    setMessage('');
    try {
      await addCategory(admin.user_id, name);
      setMessage('Категория добавлена');
      setNewCategory('');
      onChanged();
    } catch (requestError) {
      if (requestError.message?.toLocaleLowerCase('ru-RU').includes('категори') &&
          requestError.message?.toLocaleLowerCase('ru-RU').includes('существ')) {
        setNewCategoryError(requestError.message);
      } else {
        setError(requestError.message || 'Не удалось добавить категорию');
      }
    }
  };

  // Проверяет новое название и переименовывает категорию.
  const handleRenameCategory = async (event, categoryId) => {
    event.preventDefault();
    const category = categories.find((entry) => entry.category_id === categoryId);
    if (category?.name.toLocaleLowerCase('ru-RU') === 'без категории') {
      setError('Категорию «Без категории» нельзя переименовать');
      return;
    }
    const name = new FormData(event.currentTarget).get('name')?.toString().trim();
    if (!name) {
      setError('Название категории не может быть пустым');
      return;
    }
    if (containsProhibitedText(name)) {
      setError('Название категории содержит недопустимые слова');
      return;
    }
    const success = await run(
      () => updateCategory(admin.user_id, categoryId, name),
      'Название категории сохранено'
    );
    if (success) onChanged();
  };

  // Удаляет категорию после подтверждения администратора.
  const handleDeleteCategory = async (category) => {
    if (category.name.toLocaleLowerCase('ru-RU') === 'без категории') {
      setError('Категорию «Без категории» нельзя удалить');
      return;
    }
    if (!window.confirm(`Удалить категорию «${category.name}»?`)) return;
    const success = await run(
      () => deleteCategory(admin.user_id, category.category_id),
      'Категория удалена'
    );
    if (success) onChanged();
  };

  return (
    <>
      <div
        className={standalone ? 'admin-page' : 'modal-overlay'}
        onClick={standalone ? undefined : onClose}
      >
      <div
        className={standalone
          ? `admin-page-content${activeSection === 'coupons' ? ' admin-page-content-coupons' : ''}`
          : 'modal-content wide-modal'}
        onClick={standalone ? undefined : (e) => e.stopPropagation()}
      >
        <h3>Панель администратора</h3>
        {loadingAdminData && <p className="status-message">Загрузка данных админ-панели…</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {message && <div className="success-message">{message}</div>}

        <nav className="admin-section-nav" aria-label="Разделы админ-панели">
          {[
            ['catalog', 'Товары и услуги'],
            ['categories', 'Категории'],
            ['coupons', 'Купоны'],
            ['discounts', 'Скидки'],
            ['orders', 'Заказы'],
            ['users', 'Пользователи'],
            ['reviews', 'Отзывы'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={activeSection === key ? 'admin-section-button active' : 'admin-section-button'}
              onClick={() => setActiveSection(key)}
            >
              {label}
            </button>
          ))}
        </nav>

        {activeSection === 'categories' && <section className="admin-form">
          <h3>Категории</h3>
          <label className="admin-search">
            Поиск категории
            <input
              type="search"
              value={categorySearch}
              onChange={(event) => setCategorySearch(event.target.value)}
              placeholder="Название категории"
            />
          </label>
          <div className="admin-category-list">
            {visibleCategories.map((category) => (
              <div className="admin-category-row" key={category.category_id}>
                <form onSubmit={(event) => handleRenameCategory(event, category.category_id)}>
                  <input
                    name="name"
                    defaultValue={category.name}
                    maxLength={100}
                    required
                    disabled={category.name.toLocaleLowerCase('ru-RU') === 'без категории'}
                  />
                  <button
                    className="button button-outline"
                    type="submit"
                    disabled={category.name.toLocaleLowerCase('ru-RU') === 'без категории'}
                  >
                    Сохранить
                  </button>
                </form>
                <button
                  className="text-button danger-text"
                  type="button"
                  onClick={() => handleDeleteCategory(category)}
                  disabled={category.name.toLocaleLowerCase('ru-RU') === 'без категории'}
                >
                  Удалить
                </button>
              </div>
            ))}
            {visibleCategories.length === 0 && <p className="muted-copy">Категории не найдены</p>}
          </div>
          <form className="admin-add-category-form" onSubmit={handleAddCategory}>
            <input
              type="text"
              placeholder="Новая категория"
              value={newCategory}
              maxLength={100}
              onChange={(event) => {
                setNewCategory(event.target.value);
                setNewCategoryError('');
              }}
              aria-invalid={Boolean(newCategoryError)}
              aria-describedby={newCategoryError ? 'new-category-error' : undefined}
            />
            {newCategoryError && (
              <span className="field-error" id="new-category-error" role="alert">
                {newCategoryError}
              </span>
            )}
            <button type="submit" className="button button-outline">Добавить категорию</button>
          </form>
        </section>}

        {activeSection === 'catalog' && <AdminCatalogManager
          admin={admin}
          products={products}
          services={services}
          categories={categories}
          onChanged={onChanged}
        />}

        {activeSection === 'reviews' && <AdminReviewManager admin={admin} />}

        {activeSection === 'coupons' && <>
          <section className="admin-form admin-user-coupons">
            <h3>Купоны пользователей</h3>
            <p className="muted-copy">
              Изменяй название и процент скидки или назначай купон новому пользователю.
            </p>
            <label className="admin-search">
              Поиск клиента по имени, email или коду купона
              <input
                type="search"
                value={adminSearch}
                onChange={(event) => setAdminSearch(event.target.value)}
                placeholder="Имя, email или код купона"
              />
            </label>
            <div className="admin-user-coupon-grid">
              {clients.map((client) => {
                const hasLegacyCoupon = Boolean(client.discount_coupon) &&
                  Number(client.discount_percent) > 0;
                const managedCoupon = adminCoupons.find((entry) =>
                  entry.code.toLocaleUpperCase('ru-RU') ===
                  String(client.discount_coupon || '').toLocaleUpperCase('ru-RU')
                );
                const isManagedCouponExpired = managedCoupon?.expires_at &&
                  new Date(managedCoupon.expires_at) <= new Date();
                const isManagedCouponRedeemed = managedCoupon?.usage_type === 'one_time' &&
                  (managedCoupon.assigned_user_ids?.length > 0
                    ? Array.isArray(managedCoupon.redeemed_user_ids) &&
                      managedCoupon.redeemed_user_ids.includes(client.user_id)
                    : Number(managedCoupon.uses_count) > 0);
                const isManagedCouponUsageUnknown = managedCoupon?.usage_type === 'one_time' &&
                  managedCoupon.assigned_user_ids?.length > 0 &&
                  !Array.isArray(managedCoupon.redeemed_user_ids);
                const isAssignedToClient = !managedCoupon?.assigned_user_ids?.length ||
                  managedCoupon.assigned_user_ids.includes(client.user_id);
                const hasCoupon = hasLegacyCoupon;
                const couponStatus = !hasCoupon
                  ? 'Не назначен'
                  : !managedCoupon
                    ? 'Сохранён'
                    : !managedCoupon.is_active
                      ? 'Отключён'
                      : isManagedCouponExpired
                        ? 'Истёк'
                        : !isAssignedToClient
                          ? 'Не назначен этому клиенту'
                          : isManagedCouponRedeemed
                            ? 'Уже использован'
                            : isManagedCouponUsageUnknown
                              ? 'Одноразовый: статус уточняется'
                            : 'Доступен';
                return (
                  <article className="admin-user-coupon-card" key={client.user_id}>
                    <div className="admin-user-coupon-top">
                      <span className="admin-user-coupon-icon" aria-hidden="true">%</span>
                      <span className={couponStatus === 'Доступен'
                        ? 'admin-user-coupon-status active'
                        : 'admin-user-coupon-status'}
                      >
                        {couponStatus}
                      </span>
                    </div>
                    <strong className="admin-user-coupon-code">
                      {hasCoupon ? client.discount_coupon : 'Персональный купон'}
                    </strong>
                    <strong className="admin-user-coupon-percent">
                      {hasCoupon
                        ? `${managedCoupon?.percent ?? client.discount_percent}%`
                        : '—'}
                    </strong>
                    <div className="admin-user-coupon-owner">
                      <span>{client.name}</span>
                      <small>{client.email}</small>
                    </div>
                    <button
                      type="button"
                      className="button button-outline admin-user-coupon-action"
                      onClick={() => openUserCouponEditor(client)}
                    >
                      {hasCoupon ? 'Изменить купон' : 'Создать купон'}
                    </button>
                  </article>
                );
              })}
              {!loadingAdminData && clients.length === 0 && (
                <p className="muted-copy">Клиенты не найдены</p>
              )}
            </div>
          </section>

          <details className="admin-coupon-tools admin-coupon-tools-advanced">
            <summary>Дополнительное управление купонами</summary>
            <AdminCouponManager
              admin={admin}
              clients={allClients}
              onCouponsChanged={refreshAdminCoupons}
            />
            <section className="admin-form admin-historical-coupons">
              <h3>Исторические назначения купонов</h3>
              <p className="muted-copy">
                Эти сохранённые назначения не применяются при оформлении заказа.
              </p>
              {coupons.length === 0 ? (
                <p className="muted-copy">Назначений купонов пока нет</p>
              ) : (
                <ul className="coupon-admin-list admin-historical-coupon-grid">
                  {coupons.map((entry) => (
                    <li className="admin-historical-coupon-card" key={`${entry.code}-${entry.percent}`}>
                      <span className="admin-user-coupon-icon" aria-hidden="true">%</span>
                      <strong>{entry.code}</strong>
                      <b>{entry.percent}%</b>
                      <small>Назначено пользователей: {entry.users_count}</small>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </details>

          <details className="admin-coupon-tools admin-coupon-tools-bulk">
            <summary>Массовое назначение купонов</summary>
            <section className="admin-form admin-bulk-coupon-form">
              <h3>Назначить персональный купон выбранным клиентам</h3>
              <p className="muted-copy">
                Выберите клиентов и задайте общий код и процент. Укажите 0%, чтобы снять купон у выбранных клиентов.
              </p>
              <label className="admin-search">
                Поиск клиента по имени, email или коду купона
                <input
                  type="search"
                  value={adminSearch}
                  onChange={(event) => setAdminSearch(event.target.value)}
                  placeholder="Email или код купона"
                />
              </label>
              <form onSubmit={handleUserDiscount} noValidate>
                <div className="admin-user-selection">
                  <div className="admin-user-selection-toolbar">
                    <span>Выбрано: {selectedUserIds.length}</span>
                    <div>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => {
                          setSelectedUserIds(clients.map((user) => user.user_id));
                          setBulkCouponFieldErrors((current) => ({ ...current, users: '' }));
                        }}
                      >
                        Выбрать всех
                      </button>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => {
                          setSelectedUserIds([]);
                          setBulkCouponFieldErrors((current) => ({ ...current, users: '' }));
                        }}
                      >
                        Снять выбор
                      </button>
                    </div>
                  </div>
                  <div className="admin-bulk-coupon-clients" role="group" aria-label="Выберите клиентов для купона">
                    {clients.length === 0 ? (
                      <p className="muted-copy">Клиенты не найдены</p>
                    ) : (
                      clients.map((client) => (
                        <label className="admin-user-option admin-bulk-coupon-client" key={client.user_id}>
                          <input
                            type="checkbox"
                            checked={selectedUserIds.includes(client.user_id)}
                            onChange={(event) => {
                              setBulkCouponFieldErrors((current) => ({ ...current, users: '' }));
                              setSelectedUserIds((current) =>
                                event.target.checked
                                  ? [...current, client.user_id]
                                  : current.filter((id) => id !== client.user_id)
                              );
                            }}
                          />
                          <span>
                            <span className="admin-bulk-coupon-client-top">
                              <strong>{client.name}</strong>
                              <span className={`admin-user-coupon-status${client.discount_coupon ? ' active' : ''}`}>
                                {client.discount_coupon ? 'Купон назначен' : 'Без купона'}
                              </span>
                            </span>
                            <small>
                              {client.email}
                            </small>
                            <small>
                              {client.discount_coupon
                                ? `${client.discount_coupon} (${client.discount_percent}%)`
                                : 'нет купона'}
                            </small>
                          </span>
                        </label>
                      ))
                    )}
                  </div>
                </div>
                {bulkCouponFieldErrors.users && (
                  <small className="field-error" id="bulk-coupon-users-error" role="alert">
                    {bulkCouponFieldErrors.users}
                  </small>
                )}
                <label>
                  Код купона
                  <input
                    type="text"
                    placeholder="Код купона"
                    value={coupon}
                    maxLength={50}
                    onChange={(event) => {
                      setCoupon(event.target.value);
                      setBulkCouponFieldErrors((current) => ({ ...current, code: '' }));
                    }}
                    required={Number(couponPercent) > 0}
                    aria-invalid={Boolean(bulkCouponFieldErrors.code)}
                    aria-describedby={bulkCouponFieldErrors.code ? 'bulk-coupon-code-error' : undefined}
                  />
                  {bulkCouponFieldErrors.code && (
                    <small className="field-error" id="bulk-coupon-code-error" role="alert">
                      {bulkCouponFieldErrors.code}
                    </small>
                  )}
                </label>
                <label>
                  Скидка (0–99%)
                  <input
                    type="number"
                    min="0"
                    max="99"
                    value={couponPercent}
                    onChange={(event) => {
                      setCouponPercent(event.target.value);
                      setBulkCouponFieldErrors((current) => ({ ...current, percent: '' }));
                    }}
                    required
                    aria-invalid={Boolean(bulkCouponFieldErrors.percent)}
                    aria-describedby={bulkCouponFieldErrors.percent ? 'bulk-coupon-percent-error' : undefined}
                  />
                  {bulkCouponFieldErrors.percent && (
                    <small className="field-error" id="bulk-coupon-percent-error" role="alert">
                      {bulkCouponFieldErrors.percent}
                    </small>
                  )}
                </label>
                <button type="submit" className="button button-outline admin-bulk-coupon-submit">
                  Назначить выбранным клиентам
                </button>
              </form>
            </section>
          </details>
        </>}

        {activeSection === 'discounts' && <>
          <form onSubmit={handleCatalogDiscount} className="admin-form">
            <h3>Скидка в каталоге</h3>
            <label>
              Тип позиции
              <select
                value={discountItemType}
                onChange={(event) => {
                  setDiscountItemType(event.target.value);
                  setDiscountItemId('');
                }}
              >
                <option value="product">Товар</option>
                <option value="service">Услуга</option>
              </select>
            </label>
            <label>
              Позиция
              <select
                value={discountItemId}
                onChange={(event) => setDiscountItemId(event.target.value)}
                required
              >
                <option value="">Выберите позицию</option>
                {discountItems.map((item) => (
                  <option
                    key={discountItemType === 'service' ? item.service_id : item.product_id}
                    value={discountItemType === 'service' ? item.service_id : item.product_id}
                  >
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Скидка (0–99%)
              <input
                type="number"
                min="0"
                max="99"
                value={catalogDiscountPercent}
                onChange={(event) => setCatalogDiscountPercent(event.target.value)}
                required
              />
            </label>
            <button type="submit" className="button button-outline">Сохранить скидку</button>
          </form>

          <form onSubmit={handleClientProductDiscount} className="admin-form">
            <h3>Скидки на товары для выбранных клиентов</h3>
            <label className="admin-search">
              Поиск товара
              <input
                type="search"
                value={discountProductSearch}
                onChange={(event) => setDiscountProductSearch(event.target.value)}
                placeholder="Название товара"
              />
            </label>
            <div className="admin-user-selection">
              <div className="admin-user-selection-toolbar">
                <span>Выбрано товаров: {selectedProductIds.length}</span>
                <div>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setSelectedProductIds(products.map((product) => product.product_id))}
                  >
                    Выбрать все
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setSelectedProductIds([])}
                  >
                    Снять выбор
                  </button>
                </div>
              </div>
              <div className="admin-user-list" role="group" aria-label="Выберите товары для скидки">
                {visibleDiscountProducts.length === 0 ? (
                  <p className="muted-copy">Товары не найдены</p>
                ) : (
                  visibleDiscountProducts.map((product) => (
                    <label className="admin-user-option" key={product.product_id}>
                      <input
                        type="checkbox"
                        checked={selectedProductIds.includes(product.product_id)}
                        onChange={(event) => {
                          setSelectedProductIds((current) =>
                            event.target.checked
                              ? [...current, product.product_id]
                              : current.filter((id) => id !== product.product_id)
                          );
                        }}
                      />
                      <span>
                        <strong>{product.name}</strong>
                        <small>Общая скидка: {product.has_discount ? product.discount_percent : 0}%</small>
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>
            <label className="admin-search">
              Поиск клиента по имени, email или коду купона
              <input
                type="search"
                value={adminSearch}
                onChange={(event) => setAdminSearch(event.target.value)}
                placeholder="Имя, email или код купона"
              />
            </label>
            <div className="admin-user-selection">
              <div className="admin-user-selection-toolbar">
                <span>Выбрано клиентов: {productDiscountUserIds.length}</span>
                <div>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setProductDiscountUserIds(clients.map((client) => client.user_id))}
                  >
                    Выбрать всех
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setProductDiscountUserIds([])}
                  >
                    Снять выбор
                  </button>
                </div>
              </div>
              <div className="admin-user-list" role="group" aria-label="Выберите клиентов для скидки">
                {clients.length === 0 ? (
                  <p className="muted-copy">Клиенты не найдены</p>
                ) : (
                  clients.map((client) => (
                    <label className="admin-user-option" key={client.user_id}>
                      <input
                        type="checkbox"
                        checked={productDiscountUserIds.includes(client.user_id)}
                        onChange={(event) => {
                          setProductDiscountUserIds((current) =>
                            event.target.checked
                              ? [...current, client.user_id]
                              : current.filter((id) => id !== client.user_id)
                          );
                        }}
                      />
                      <span>
                        <strong>{client.name}</strong>
                        <small>{client.email}</small>
                        <small>
                          {client.discount_coupon
                            ? `Купон: ${client.discount_coupon} · скидка ${client.discount_percent}%`
                            : 'Купон не назначен'}
                        </small>
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>
            <label>
              Скидка (0–99%)
              <input
                type="number"
                min="0"
                max="99"
                value={productDiscountPercent}
                onChange={(event) => setProductDiscountPercent(event.target.value)}
                required
              />
            </label>
            <small className="muted-copy">0% снимает адресные скидки для выбранных пар «товар–клиент».</small>
            <button type="submit" className="button button-outline">Сохранить скидку</button>
          </form>
        </>}

        {activeSection === 'orders' && <AdminOrderManager admin={admin} />}

        {activeSection === 'users' && <>
          <section className="admin-form">
            <h3>Статус пользователей</h3>
            <label className="admin-search">
              Поиск пользователя по имени или email
              <input
                type="search"
                value={userSearch}
                onChange={(event) => setUserSearch(event.target.value)}
                placeholder="Имя или email"
              />
            </label>
            <div className="admin-catalog-list">
              {visibleUsers.filter((user) => user.role === 'client').map((client) => (
                <article className="admin-catalog-row" key={`user-${client.user_id}`}>
                  <div>
                    <strong>{client.name}</strong>
                    <small>{client.email} · {client.is_active ? 'Активен' : 'Заблокирован'}</small>
                  </div>
                  <button
                    type="button"
                    className="button button-outline"
                    onClick={() => handleUserStatus(client)}
                  >
                    {client.is_active ? 'Заблокировать' : 'Разблокировать'}
                  </button>
                </article>
              ))}
              {visibleUsers.filter((user) => user.role === 'client').length === 0 && (
                <p className="muted-copy">Пользователи не найдены</p>
              )}
            </div>
          </section>
        </>}

        <div className="modal-actions">
          <button className="button button-outline" onClick={onClose}>
            {standalone ? 'Вернуться в профиль' : 'Закрыть'}
          </button>
        </div>
      </div>
      </div>
      {couponEditorClient && createPortal(
        <div className="modal-overlay" onClick={() => setCouponEditorClient(null)}>
          <form
            className="modal-content admin-user-coupon-editor"
            role="dialog"
            aria-modal="true"
            aria-labelledby="user-coupon-editor-title"
            onClick={(event) => event.stopPropagation()}
            onSubmit={handleSingleUserDiscount}
            noValidate
          >
            <h3 id="user-coupon-editor-title">
              {couponEditorClient.discount_coupon ? 'Изменить купон' : 'Создать купон'}
            </h3>
            <p className="muted-copy">{couponEditorClient.name} · {couponEditorClient.email}</p>
            {error && <p className="form-error" role="alert">{error}</p>}
            <label>
              Код купона
              <input
                type="text"
                value={coupon}
                onChange={(event) => {
                  setCoupon(event.target.value);
                  setSingleCouponFieldErrors((current) => ({ ...current, code: '' }));
                }}
                maxLength={50}
                required={Number(couponPercent) > 0}
                aria-invalid={Boolean(singleCouponFieldErrors.code)}
                aria-describedby={singleCouponFieldErrors.code ? 'single-coupon-code-error' : undefined}
              />
              {singleCouponFieldErrors.code && (
                <small className="field-error" id="single-coupon-code-error" role="alert">
                  {singleCouponFieldErrors.code}
                </small>
              )}
            </label>
            <label>
              Скидка (0–99%)
              <input
                type="number"
                min="0"
                max="99"
                value={couponPercent}
                onChange={(event) => {
                  setCouponPercent(event.target.value);
                  setSingleCouponFieldErrors((current) => ({ ...current, percent: '' }));
                }}
                required
                aria-invalid={Boolean(singleCouponFieldErrors.percent)}
                aria-describedby={singleCouponFieldErrors.percent ? 'single-coupon-percent-error' : undefined}
              />
              {singleCouponFieldErrors.percent && (
                <small className="field-error" id="single-coupon-percent-error" role="alert">
                  {singleCouponFieldErrors.percent}
                </small>
              )}
            </label>
            <div className="modal-actions">
              <button type="submit" className="button button-outline">
                Сохранить купон
              </button>
              <button
                type="button"
                className="button button-outline"
                onClick={() => setCouponEditorClient(null)}
              >
                Отмена
              </button>
            </div>
          </form>
        </div>,
        document.querySelector('.app-shell') || document.body
      )}
    </>
  );
};
