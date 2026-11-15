import { ProductCard } from './ProductCard';

export const Products = ({ products, onAddToCart }) => (
  <section className="catalog-section">
    <div className="section-heading">
      <h2>Наши товары</h2>
    </div>
    {products.length === 0 ? (
      <p className="muted-copy">Товаров в выбранных категориях нет</p>
    ) : (
      <div className="product-grid">
        {products.map((product) => (
          <ProductCard
            key={product.product_id}
            product={product}
            onAddToCart={onAddToCart}
          />
        ))}
      </div>
    )}
  </section>
);
