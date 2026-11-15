export const CartModal = ({
  cart,
  user,
  onClose,
  onChangeQuantity,
  onRemoveItem,
  onCheckout,
}) => {
  const subtotal = cart.reduce((sum, item) => sum + item.finalPrice * item.quantity, 0);
  const userDiscount = user ? Number(user.discount_percent) || 0 : 0;
  const total = Math.round(subtotal * (1 - userDiscount / 100));

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
                  <div>
                    <span className="cart-item-name">{item.name}</span>
                    <span className="cart-item-unit-price">
                      {item.type === 'service' ? 'Услуга' : 'Товар'} · {item.finalPrice} ₽
                    </span>
                  </div>
                  <div className="modal-item-controls">
                    <div className="quantity-control">
                      <button onClick={() => onChangeQuantity(item, -1)} disabled={item.quantity <= 1}>
                        −
                      </button>
                      <span className="cart-quantity-value">{item.quantity}</span>
                      <button onClick={() => onChangeQuantity(item, 1)} disabled={item.quantity >= 100}>
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
              <div>Сумма: {subtotal} ₽</div>
              {userDiscount > 0 && (
                <div className="coupon-line">
                  Купон {user.discount_coupon}: -{userDiscount}% (-{subtotal - total} ₽)
                </div>
              )}
              <div className="pay-line">К оплате: {total} ₽</div>
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
