import { ServiceReviews } from './ServiceReviews';

// Отображает карточку товара и действия для покупателя или администратора.
export const ProductCard = ({
  product,
  onAddToCart,
  onDelete,
  isAuthenticated,
  isAdmin,
  user,
}) => {
  const finalPrice = product.has_discount
    ? Math.round(product.price * (1 - product.discount_percent / 100))
    : product.price;

  return (
    <article className="product-card">
      {product.image_url && (
        <div className="product-image-wrap">
          <img src={product.image_url} alt={product.name} />
          {product.has_discount && (
            <span className="discount-badge">-{product.discount_percent}%</span>
          )}
        </div>
      )}
      <div className="product-info">
        <p className="product-category">{product.category_name}</p>
        <h2>{product.name}</h2>
        <p className="product-description">{product.description}</p>
        <p className="product-stock">
          {Number(product.stock_quantity) > 0
            ? `В наличии: ${product.stock_quantity} шт.`
            : 'Нет в наличии'}
        </p>
        <p className="product-price">
          {product.has_discount && (
            <span className="old-price">{product.price} ₽</span>
          )}
          {finalPrice} ₽
        </p>
        {!isAdmin && (
          <button
            className="button button-primary product-button"
            disabled={!Number.isFinite(Number(product.stock_quantity)) || Number(product.stock_quantity) <= 0}
            onClick={() =>
              onAddToCart({
                type: 'product',
                id: product.product_id,
                name: product.name,
                image_url: product.image_url,
                price: product.price,
                finalPrice,
                discount_percent: product.has_discount ? product.discount_percent : 0,
                stock_quantity: product.stock_quantity,
              })
            }
          >
            {isAuthenticated ? 'В корзину' : 'Войти, чтобы добавить в корзину'}
          </button>
        )}
        <ServiceReviews
          serviceId={product.product_id}
          itemName={product.name}
          type="product"
          user={user}
        />
        {isAdmin && (
          <button
            className="button button-outline product-button"
            type="button"
            onClick={() => onDelete(product, 'product')}
          >
            Удалить
          </button>
        )}
      </div>
    </article>
  );
};
