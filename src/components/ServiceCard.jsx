export const ServiceCard = ({ service, onAddToCart }) => {
  const finalPrice = service.has_discount
    ? Math.round(service.price * (1 - service.discount_percent / 100))
    : service.price;

  return (
    <article className="product-card service-card">
      {service.image_url && (
        <div className="product-image-wrap">
          <img src={service.image_url} alt={service.name} />
          {service.has_discount && (
            <span className="discount-badge">-{service.discount_percent}%</span>
          )}
        </div>
      )}
      <div className="product-info">
        <div className="card-category-row">
          <p className="product-category">{service.category_name}</p>
          {!service.image_url && service.has_discount && (
            <span className="inline-discount">-{service.discount_percent}%</span>
          )}
        </div>
        <h2>{service.name}</h2>
        <p className="product-description">{service.description}</p>
        <p className="service-duration">Длительность: {service.duration} мин.</p>
        <p className="product-price">
          {service.has_discount && (
            <span className="old-price">{service.price} ₽</span>
          )}
          {finalPrice} ₽
        </p>
        <button
          className="button button-primary product-button"
          onClick={() =>
            onAddToCart({
              type: 'service',
              id: service.service_id,
              name: service.name,
              finalPrice,
            })
          }
        >
          В корзину
        </button>
      </div>
    </article>
  );
};
