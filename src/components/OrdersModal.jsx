import { useEffect, useState } from 'react';
import { getMyOrders } from '../api/client';

const STATUS = {
  new: 'новый',
  scheduled: 'запланировано',
  completed: 'выполнено',
};

export const OrdersModal = ({ user, onClose }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getMyOrders(user.user_id)
      .then(setData)
      .catch((err) => setError(err.message));
  }, [user.user_id]);

  const isEmpty = data && data.orders.length === 0 && data.appointments.length === 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content wide-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Мои заказы и записи</h3>
        {error && <p className="form-error" role="alert">{error}</p>}
        {!data && !error && <p className="status-message">Загрузка...</p>}
        {isEmpty && <p className="muted-copy">Пока ничего нет. Выберите товар или услугу в каталоге.</p>}

        {data?.orders.map((order) => (
          <div key={`o${order.order_id}`} className="history-item">
            <strong>Заказ №{order.order_id}</strong>
            <span> · {new Date(order.created_at).toLocaleDateString('ru-RU')}</span>
            <ul>
              {order.items.map((item, i) => (
                <li key={i}>
                  {item.name} × {item.quantity} — {item.unit_price} ₽
                </li>
              ))}
            </ul>
            <div>
              Итого: {order.total} ₽ · {STATUS[order.status] || order.status}
            </div>
          </div>
        ))}

        {data?.appointments.map((a) => (
          <div key={`a${a.appointment_id}`} className="history-item">
            <strong>{a.service_name}</strong>
            {a.quantity > 1 && <span> × {a.quantity}</span>}
            <div>
              {new Date(a.appointment_date).toLocaleDateString('ru-RU')} в {a.appointment_time} ·{' '}
              {STATUS[a.status] || a.status}
            </div>
            {a.amount != null && <div>Оплачено: {a.amount} ₽</div>}
          </div>
        ))}

        <div className="modal-actions">
          <button className="button button-outline" onClick={onClose}>Закрыть</button>
        </div>
      </div>
    </div>
  );
};
