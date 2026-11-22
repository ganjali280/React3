// Отображает содержимое корзины и позволяет изменить её состав.
export const CartModal = ({
  cart,
  onClose,
  onChangeQuantity,
  onRemoveItem,
  onCheckout,
}) => {
  const originalSubtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const subtotal = cart.reduce((sum, item) => sum + item.finalPrice * item.quantity, 0);
  const discountAmount = originalSubtotal - subtotal;
  const discountPercent = originalSubtotal > 0
    ? Math.round((discountAmount / originalSubtotal) * 100)
    : 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content cart-modal" onClick={(e) => e.stopPropagation()}>
        <h3>Корзина</h3>
        {cart.length === 0 ? (
          <p className="muted-copy">Корзина пуста</p>
        ) : (
          <>
            <ul className="modal-cart-list">
              {cart.map((item) => (
                <li key={`${item.type}-${item.id}`} className="modal-cart-item">
                  <div className="modal-cart-item-details">
                    {item.image_url && (
                      <img className="cart-item-image" src={item.image_url} alt={item.name} />
                    )}
                    <div className="modal-cart-item-copy">
                      <span className="cart-item-name">{item.name}</span>
                      <span className="cart-item-unit-price">
                        {item.type === 'service' ? 'Услуга' : 'Товар'} · {item.finalPrice} ₽ за шт.
                      </span>
                      {Number(item.discount_percent) > 0 && (
                        <span className="cart-item-discounted-price">
                          Скидка {item.discount_percent}%
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="modal-item-controls">
                    <div className="quantity-control">
                      <button onClick={() => onChangeQuantity(item, -1)} disabled={item.quantity <= 1}>
                        −
                      </button>
                      <span className="cart-quantity-value">{item.quantity}</span>
                      <button
                        onClick={() => onChangeQuantity(item, 1)}
                        disabled={item.quantity >= (item.type === 'product' ? Number(item.stock_quantity) || 0 : 100)}
                      >
                        +
                      </button>
                    </div>
                    <button className="text-button" onClick={() => onRemoveItem(item)}>
                      Удалить
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <div className="cart-summary">
              <div>Сумма до скидки: {originalSubtotal} ₽</div>
              <div className="coupon-line">
                Скидка: −{discountAmount} ₽ ({discountPercent}%)
              </div>
              <div className="pay-line">К оплате: {subtotal} ₽</div>
            </div>
            <button
              className="button button-primary checkout-button"
              style={{ width: '100%' }}
              onClick={onCheckout}
            >
              Оформить заказ
            </button>
          </>
        )}
        <div className="modal-actions">
          <button className="button button-outline" onClick={onClose}>
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
};
