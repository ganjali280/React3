import { useEffect, useState } from 'react';
import { getUsers, setItemDiscount, setUserDiscount } from '../api/client';

export const AdminModal = ({ admin, products, services, onClose, onChanged }) => {
  const [users, setUsers] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const [itemKey, setItemKey] = useState('');
  const [itemPercent, setItemPercent] = useState('10');

  const [userEmail, setUserEmail] = useState('');
  const [coupon, setCoupon] = useState('');
  const [couponPercent, setCouponPercent] = useState('10');

  const loadUsers = () =>
    getUsers(admin.user_id)
      .then(setUsers)
      .catch((err) => setError(err.message));

  useEffect(() => {
    loadUsers();
  }, []);

  const run = async (action, okText) => {
    setError('');
    setMessage('');
    try {
      await action();
      setMessage(okText);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleItemDiscount = (e) => {
    e.preventDefault();
    const [type, id] = itemKey.split(':');
    run(async () => {
      await setItemDiscount(admin.user_id, type, id, Number(itemPercent));
      onChanged();
    }, 'Скидка сохранена (0% — убрать скидку)');
  };

  const handleUserDiscount = (e) => {
    e.preventDefault();
    run(async () => {
      await setUserDiscount(admin.user_id, {
        email: userEmail,
        discount_coupon: coupon,
        discount_percent: Number(couponPercent),
      });
      await loadUsers();
    }, 'Купон пользователя обновлён');
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content wide-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Панель администратора</h3>
        {error && <p className="form-error" role="alert">{error}</p>}
        {message && <div className="success-message">{message}</div>}

        <form onSubmit={handleItemDiscount} className="admin-form">
          <h3>Скидка на товар / услугу</h3>
          <select value={itemKey} onChange={(e) => setItemKey(e.target.value)} required>
            <option value="" disabled>Выберите позицию</option>
            <optgroup label="Товары">
              {products.map((p) => (
                <option key={`p${p.product_id}`} value={`product:${p.product_id}`}>
                  {p.name} ({p.has_discount ? p.discount_percent : 0}%)
                </option>
              ))}
            </optgroup>
            <optgroup label="Услуги">
              {services.map((s) => (
                <option key={`s${s.service_id}`} value={`service:${s.service_id}`}>
                  {s.name} ({s.has_discount ? s.discount_percent : 0}%)
                </option>
              ))}
            </optgroup>
          </select>
          <input
            type="number"
            min="0"
            max="90"
            value={itemPercent}
            onChange={(e) => setItemPercent(e.target.value)}
            required
          />
          <button type="submit" className="button button-outline">Сохранить скидку</button>
        </form>

        <form onSubmit={handleUserDiscount} className="admin-form">
          <h3>Персональный купон</h3>
          <select value={userEmail} onChange={(e) => setUserEmail(e.target.value)} required>
            <option value="" disabled>Выберите пользователя</option>
            {users.map((u) => (
              <option key={u.user_id} value={u.email}>
                {u.name} — {u.discount_coupon ? `${u.discount_coupon} (${u.discount_percent}%)` : 'нет купона'}
              </option>
            ))}
          </select>
          <input
            type="text"
            placeholder="Код купона"
            value={coupon}
            onChange={(e) => setCoupon(e.target.value)}
          />
          <input
            type="number"
            min="0"
            max="90"
            value={couponPercent}
            onChange={(e) => setCouponPercent(e.target.value)}
            required
          />
          <button type="submit" className="button button-outline">Сохранить купон</button>
        </form>

        <div className="modal-actions">
          <button className="button button-outline" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
};
