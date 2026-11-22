import { ServiceReviews } from './ServiceReviews';
import { getServiceImage } from './serviceImages';

// Отображает карточку услуги и доступные для пользователя действия.
export const ServiceCard = ({
  service,
  onAddToCart,
  onDelete,
  isAuthenticated,
  isAdmin,
  user,
}) => {
  const imageUrl = getServiceImage(service);
  const finalPrice = service.has_discount
    ? Math.round(service.price * (1 - service.discount_percent / 100))
    : service.price;

  return (
    <article className="product-card service-card">
      <div className="product-image-wrap">
        <img src={imageUrl} alt={service.name} loading="lazy" />
        {service.has_discount && (
          <span className="discount-badge">-{service.discount_percent}%</span>
        )}
      </div>
      <div className="product-info">
        <p className="product-category">{service.category_name}</p>
        <h2>{service.name}</h2>
        <p className="product-description">{service.description}</p>
        <p className="service-duration">Длительность: {service.duration} мин.</p>
        <p className="product-price">
          {service.has_discount && (
            <span className="old-price">{service.price} ₽</span>
          )}
          {finalPrice} ₽
        </p>
        {!isAdmin && (
          <button
            className="button button-primary product-button"
            onClick={() =>
              onAddToCart({
                type: 'service',
                id: service.service_id,
                name: service.name,
                image_url: imageUrl,
                price: service.price,
                finalPrice,
                discount_percent: service.has_discount ? service.discount_percent : 0,
              })
            }
          >
            {isAuthenticated ? 'В корзину' : 'Войти, чтобы добавить в корзину'}
          </button>
        )}
        <ServiceReviews
          serviceId={service.service_id}
          itemName={service.name}
          user={user}
        />
        {isAdmin && (
          <button
            className="button button-outline product-button"
            type="button"
            onClick={() => onDelete(service, 'service')}
          >
            Удалить
          </button>
        )}
      </div>
    </article>
  );
};
