import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getMyOrders } from '../api/client';
import { getServiceImage } from './serviceImages';

const STATUS = {
  new: 'новый',
  scheduled: 'запланировано',
  completed: 'выполнено',
};

const PAYMENT_STATUS = {
  pending: 'ожидает оплаты при получении',
  completed: 'оплачен',
  failed: 'ошибка оплаты',
};

// Форматирует сумму в рублях для списка заказов.
const formatPrice = (price) => `${Number(price).toLocaleString('ru-RU')} ₽`;

// Показывает товар или услугу с изображением, количеством и стоимостью.
const HistoryLineItem = ({
  name,
  imageUrl,
  quantity,
  unitPrice,
  unitPriceLabel = 'Цена за единицу',
  lineTotal,
  lineTotalLabel = 'Итого',
}) => (
  <li>
    {imageUrl && (
      <img className="order-item-image" src={imageUrl} alt={name} />
    )}
    <span>
      <strong>{name}</strong>
      <br />
      Количество: {quantity}
      {unitPrice != null && Number.isFinite(Number(unitPrice)) && (
        <> · {unitPriceLabel}: {formatPrice(unitPrice)}</>
      )}
      {lineTotal != null && Number.isFinite(Number(lineTotal)) && (
        <> · {lineTotalLabel}: {formatPrice(lineTotal)}</>
      )}
    </span>
  </li>
);

// Показывает историю заказов клиента и состав каждого заказа.
export const OrdersPage = ({ user, embedded = false }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retryCount, setRetryCount] = useState(0);
  const userId = user?.user_id;

  useEffect(() => {
    if (!userId) return undefined;
    let active = true;

    getMyOrders(userId)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || 'Не удалось загрузить историю');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [userId, retryCount]);

  // Повторно загружает историю заказов после ошибки.
  const retry = () => {
    setData(null);
    setError('');
    setLoading(true);
    setRetryCount((count) => count + 1);
  };

  if (!user) {
    return (
      <section className="orders-page">
        <div className="empty-state">
          <p className="eyebrow">ЛИЧНЫЙ КАБИНЕТ</p>
          <h1>Войдите, чтобы увидеть историю</h1>
          <Link className="button button-primary" to="/login">Войти</Link>
        </div>
      </section>
    );
  }

  const orders = data?.orders ?? [];
  const appointments = data?.appointments ?? [];
  const isEmpty = data && orders.length === 0 && appointments.length === 0;

  return (
    <section
      id={embedded ? 'orders-history' : undefined}
      className={embedded ? 'profile-orders-section' : 'orders-page'}
    >
      <div className="section-heading">
        {embedded ? <h2>История заказов и записей</h2> : <h1>История заказов и записей</h1>}
        <p>Товарные заказы и оформленные записи на услуги.</p>
      </div>

      {loading && <p className="status-message">Загрузка истории...</p>}
      {error && (
        <div className="state-block error" role="alert">
          <p>{error}</p>
          <button className="button button-outline" onClick={retry}>Попробовать снова</button>
        </div>
      )}
      {isEmpty && (
        <div className={`empty-state ${embedded ? 'orders-empty-state' : ''}`}>
          <p>Пока заказов и записей нет.</p>
          <Link className="button button-primary" to="/">Перейти в каталог</Link>
        </div>
      )}

      {!loading && !error && data && (
        <div className="history-list">
          {orders.map((order) => {
            const services = order.services ?? [];
            const servicesTotal = services.reduce(
              (sum, service) => sum + (Number(service.amount) || 0),
              0
            );
            const total = Number(order.total) + servicesTotal;

            return (
              <article key={`order-${order.order_id}`} className="history-item">
                <strong>Заказ №{order.user_order_number || order.order_id}</strong>
                <span> · {new Date(order.created_at).toLocaleDateString('ru-RU')}</span>
                {order.delivery_address && <p>Адрес доставки: {order.delivery_address}</p>}
                {order.delivery_date && (
                  <p>Дата доставки: {new Date(`${order.delivery_date}T00:00:00`).toLocaleDateString('ru-RU')}</p>
                )}
                <ul>
                  {(order.items ?? []).map((item, index) => (
                    <HistoryLineItem
                      key={`product-${item.product_id ?? index}`}
                      name={item.name}
                      imageUrl={item.image_url}
                      quantity={item.quantity}
                      unitPrice={item.unit_price}
                      unitPriceLabel={Number(order.coupon_percent) > 0
                        ? 'Цена за единицу до купона'
                        : 'Цена за единицу'}
                      lineTotal={Math.round(
                        Number(item.unit_price) *
                          Number(item.quantity) *
                          (1 - (Number(order.coupon_percent) || 0) / 100)
                      )}
                      lineTotalLabel={Number(order.coupon_percent) > 0
                        ? 'После купона'
                        : 'Итого'}
                    />
                  ))}
                  {services.map((service) => (
                    <HistoryLineItem
                      key={`service-${service.appointment_id}`}
                      name={service.service_name}
                      imageUrl={getServiceImage({
                        ...service,
                        name: service.service_name,
                      })}
                      quantity={service.quantity}
                      unitPrice={
                        service.amount == null
                          ? service.current_price
                          : Number(service.amount) / Number(service.quantity)
                      }
                      unitPriceLabel={service.amount == null
                        ? 'Текущая цена за единицу'
                        : 'Цена за единицу'}
                      lineTotal={
                        service.amount == null
                          ? Number(service.current_price) * Number(service.quantity)
                          : service.amount
                      }
                    />
                  ))}
                </ul>
                {Number(order.coupon_percent) > 0 && (
                  <div className="coupon-total">
                    Купон {order.coupon_code}: скидка {order.coupon_percent}% (−{order.coupon_discount_amount} ₽)
                  </div>
                )}
                <div>
                  Итого: {total} ₽ · {STATUS[order.status] || order.status}
                </div>
                {order.payment_status && (
                  <div>
                    Оплата: {PAYMENT_STATUS[order.payment_status] || order.payment_status}
                    {order.payment_status === 'pending' &&
                      order.payment_method === 'at_delivery' &&
                      ' (при получении)'}
                  </div>
                )}
              </article>
            );
          })}

          {appointments.map((appointment) => (
            <article key={`appointment-${appointment.appointment_id}`} className="history-item">
              <strong>
                Заказ №{appointment.user_order_number || appointment.order_id || appointment.appointment_id}
              </strong>
              <ul>
                <HistoryLineItem
                  name={appointment.service_name}
                  imageUrl={getServiceImage({
                    ...appointment,
                    name: appointment.service_name,
                  })}
                  quantity={appointment.quantity}
                  unitPrice={
                    appointment.amount == null
                      ? appointment.current_price
                      : Number(appointment.amount) / Number(appointment.quantity)
                  }
                  unitPriceLabel={appointment.amount == null
                    ? 'Текущая цена за единицу'
                    : 'Цена за единицу'}
                  lineTotal={
                    appointment.amount == null
                      ? Number(appointment.current_price) * Number(appointment.quantity)
                      : appointment.amount
                  }
                />
              </ul>
              <div>
                {new Date(appointment.appointment_date).toLocaleDateString('ru-RU')} в{' '}
                {appointment.appointment_time} · {STATUS[appointment.status] || appointment.status}
              </div>
              {appointment.amount != null && (
                <div>Оплата: {PAYMENT_STATUS[appointment.payment_status] || 'статус оплаты неизвестен'}</div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
};
