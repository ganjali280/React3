import { ProductCard } from './ProductCard';

// Показывает отфильтрованный список товаров и состояние пустого результата.
// Показывает отфильтрованный список товаров и состояние пустого результата.
export const Products = ({
  products,
  onAddToCart,
  onDelete,
  isAuthenticated,
  isAdmin,
  user,
}) => (
  <section className="catalog-section">
    <div className="section-heading">
      <h2>Наши товары</h2>
      <p className="catalog-count">Найдено: {products.length}</p>
    </div>
    {products.length === 0 ? (
      <p className="muted-copy">По выбранным условиям товары не найдены</p>
    ) : (
      <div className="product-grid">
        {products.map((product) => (
          <ProductCard
            key={product.product_id}
            product={product}
            onAddToCart={onAddToCart}
            onDelete={onDelete}
            isAuthenticated={isAuthenticated}
            isAdmin={isAdmin}
            user={user}
          />
        ))}
      </div>
    )}
  </section>
);
