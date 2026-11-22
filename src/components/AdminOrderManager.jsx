import { useEffect, useState } from 'react';
import {
  getAdminAppointments,
  getAdminOrders,
  markAdminAppointmentPaid,
  markAdminOrderPaid,
  updateAdminAppointmentStatus,
  updateAdminOrderStatus,
} from '../api/client';

const PAYMENT_STATUS = {
  pending: 'ожидает оплаты',
  completed: 'оплачен',
  failed: 'ошибка оплаты',
};

// Показывает администратору заказы и записи с управлением статусом и оплатой.
export const AdminOrderManager = ({ admin }) => {
  const [orders, setOrders] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [orderStatuses, setOrderStatuses] = useState({});
  const [appointmentStatuses, setAppointmentStatuses] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    Promise.all([getAdminOrders(admin.user_id), getAdminAppointments(admin.user_id)])
      .then(([orderList, appointmentList]) => {
        if (!active) return;
        setOrders(orderList);
        setAppointments(appointmentList);
        setOrderStatuses(Object.fromEntries(orderList.map((order) => [order.order_id, order.status])));
        setAppointmentStatuses(
          Object.fromEntries(appointmentList.map((appointment) => [
            appointment.appointment_id,
            appointment.status,
          ]))
        );
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || 'Не удалось загрузить заказы и записи');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [admin.user_id, refreshKey]);

  // Сохраняет новый статус заказа или записи на услугу.
  const saveStatus = async (type, id) => {
    const key = `${type}-${id}`;
    setSavingKey(key);
    setError('');
    try {
      if (type === 'order') {
        await updateAdminOrderStatus(admin.user_id, id, orderStatuses[id]);
      } else {
        await updateAdminAppointmentStatus(admin.user_id, id, appointmentStatuses[id]);
      }
      setRefreshKey((value) => value + 1);
    } catch (requestError) {
      setError(requestError.message || 'Не удалось сохранить статус');
    } finally {
      setSavingKey('');
    }
  };

  // Подтверждает получение оплаты за заказ или услугу.
  const markPaymentReceived = async (type, id) => {
    const key = `${type}-payment-${id}`;
    setSavingKey(key);
    setError('');
    try {
      if (type === 'order') {
        await markAdminOrderPaid(admin.user_id, id);
      } else {
        await markAdminAppointmentPaid(admin.user_id, id);
      }
      setRefreshKey((value) => value + 1);
    } catch (requestError) {
      setError(requestError.message || 'Не удалось подтвердить оплату');
    } finally {
      setSavingKey('');
    }
  };

  const normalizedQuery = query.trim().toLocaleLowerCase('ru-RU');
  const visibleOrders = orders.filter((order) =>
    [
      order.user_order_number,
      order.order_id,
      order.customer_name,
      order.customer_email,
      order.status,
      order.payment_status,
    ]
      .some((value) => String(value || '').toLocaleLowerCase('ru-RU').includes(normalizedQuery))
  );
  const visibleAppointments = appointments.filter((appointment) =>
    [
      appointment.user_order_number,
      appointment.order_id,
      appointment.service_name,
      appointment.customer_name,
      appointment.customer_email,
      appointment.status,
      appointment.payment_status,
    ]
      .some((value) => String(value || '').toLocaleLowerCase('ru-RU').includes(normalizedQuery))
  );

  return (
    <section className="admin-form admin-order-manager">
      <h3>Заказы и записи</h3>
      {loading && <p className="muted-copy">Загрузка заказов…</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <label className="admin-search">
        Поиск заказа, клиента или записи
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Номер, имя, email или статус"
        />
      </label>

      <h4>Все заказы</h4>
      <div className="admin-catalog-list">
        {visibleOrders.map((order) => (
          <article className="admin-operation-row" key={`order-${order.order_id}`}>
            <div>
              <strong>Заказ №{order.order_id} · {order.customer_name}</strong>
              <small>
                {order.customer_email} · {order.total} ₽ ·{' '}
                {order.delivery_date
                  ? new Date(`${order.delivery_date}T00:00:00`).toLocaleDateString('ru-RU')
                  : 'дата доставки не задана'}
              </small>
              {order.delivery_address && <small>{order.delivery_address}</small>}
              {order.payment_status && (
                <small>
                  Оплата: {PAYMENT_STATUS[order.payment_status] || order.payment_status}
                  {order.payment_method === 'at_delivery' ? ' при получении' : ''}
                </small>
              )}
              {order.items?.length > 0 && (
                <ul className="admin-order-items">
                  {order.items.map((item) => (
                    <li key={`${item.product_id}-${item.name}`}>
                      {item.image_url && <img src={item.image_url} alt={item.name} />}
                      {item.name} × {item.quantity}
                    </li>
                  ))}
                </ul>
              )}
              {Number(order.coupon_percent) > 0 && (
                <small>
                  Купон {order.coupon_code}: −{order.coupon_percent}% (−{order.coupon_discount_amount} ₽)
                </small>
              )}
            </div>
            <div className="admin-operation-controls">
              <select
                aria-label={`Статус заказа №${order.order_id}`}
                value={orderStatuses[order.order_id] || order.status}
                onChange={(event) => setOrderStatuses({
                  ...orderStatuses,
                  [order.order_id]: event.target.value,
                })}
              >
                <option value="new">Новый</option>
                <option value="scheduled">Запланирован</option>
                <option value="completed">Выполнен</option>
              </select>
              <button
                className="button button-outline"
                type="button"
                disabled={savingKey === `order-${order.order_id}` || orderStatuses[order.order_id] === order.status}
                onClick={() => saveStatus('order', order.order_id)}
              >
                Сохранить
              </button>
              {order.status === 'completed' &&
                order.payment_status === 'pending' &&
                order.payment_method === 'at_delivery' && (
                  <button
                    className="button button-outline"
                    type="button"
                    disabled={savingKey === `order-payment-${order.order_id}`}
                    onClick={() => markPaymentReceived('order', order.order_id)}
                  >
                    {savingKey === `order-payment-${order.order_id}` ? 'Сохранение…' : 'Подтвердить оплату'}
                  </button>
                )}
            </div>
          </article>
        ))}
        {!loading && visibleOrders.length === 0 && <p className="muted-copy">Заказы не найдены</p>}
      </div>

      <h4>Записи на услуги</h4>
      <div className="admin-catalog-list">
        {visibleAppointments.map((appointment) => (
          <article className="admin-operation-row" key={`appointment-${appointment.appointment_id}`}>
            <div>
              <strong>
                Заказ №{appointment.order_id || appointment.appointment_id}
                {' · '}{appointment.service_name} · {appointment.customer_name}
              </strong>
              <small>
                {appointment.customer_email} · ×{appointment.quantity} ·{' '}
                {new Date(`${appointment.appointment_date}T00:00:00`).toLocaleDateString('ru-RU')} в{' '}
                {appointment.appointment_time}
              </small>
              {appointment.payment_status && (
                <small>
                  Оплата: {PAYMENT_STATUS[appointment.payment_status] || appointment.payment_status}
                  {appointment.payment_method === 'at_delivery' ? ' при получении' : ''}
                </small>
              )}
            </div>
            <div className="admin-operation-controls">
              <select
                aria-label={`Статус записи ${appointment.appointment_id}`}
                value={appointmentStatuses[appointment.appointment_id] || appointment.status}
                onChange={(event) => setAppointmentStatuses({
                  ...appointmentStatuses,
                  [appointment.appointment_id]: event.target.value,
                })}
              >
                <option value="scheduled">Запланирована</option>
                <option value="completed">Выполнена</option>
              </select>
              <button
                className="button button-outline"
                type="button"
                disabled={
                  savingKey === `appointment-${appointment.appointment_id}` ||
                  appointmentStatuses[appointment.appointment_id] === appointment.status
                }
                onClick={() => saveStatus('appointment', appointment.appointment_id)}
              >
                Сохранить
              </button>
              {appointment.status === 'completed' &&
                appointment.payment_status === 'pending' &&
                appointment.payment_method === 'at_delivery' && (
                  <button
                    className="button button-outline"
                    type="button"
                    disabled={savingKey === `appointment-payment-${appointment.appointment_id}`}
                    onClick={() => markPaymentReceived('appointment', appointment.appointment_id)}
                  >
                    {savingKey === `appointment-payment-${appointment.appointment_id}`
                      ? 'Сохранение…'
                      : 'Подтвердить оплату'}
                  </button>
                )}
            </div>
          </article>
        ))}
        {!loading && visibleAppointments.length === 0 && <p className="muted-copy">Записи не найдены</p>}
      </div>
    </section>
  );
};
