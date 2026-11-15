export const ProductCard = ({ product, onAddToCart }) => {
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
        <p className="product-price">
          {product.has_discount && (
            <span className="old-price">{product.price} ₽</span>
          )}
          {finalPrice} ₽
        </p>
        <button
          className="button button-primary product-button"
          onClick={() =>
            onAddToCart({
              type: 'product',
              id: product.product_id,
              name: product.name,
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
