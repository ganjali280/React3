import { useCallback, useMemo, useReducer } from 'react';
import { CartContext } from './cartContextValue';

// Сравнивает позиции корзины по типу и идентификатору.
const sameItem = (left, right) =>
  left.type === right.type && left.id === right.id;

// Возвращает максимально допустимое количество выбранной позиции.
const itemLimit = (item) =>
  item.type === 'product'
    ? Math.max(0, Number(item.stock_quantity) || 0)
    : 100;

// Обрабатывает добавление, изменение, удаление и замену содержимого корзины.
const cartReducer = (cart, action) => {
  switch (action.type) {
    case 'add': {
      if (action.item.type === 'product' && itemLimit(action.item) <= 0) {
        return cart;
      }
      const existing = cart.find((item) => sameItem(item, action.item));
      return existing
        ? cart.map((item) =>
            sameItem(item, action.item)
              ? {
                  ...item,
                  ...action.item,
                  quantity: Math.min(itemLimit(action.item), item.quantity + 1),
                }
              : item
          )
        : [...cart, { ...action.item, quantity: 1 }];
    }
    case 'changeQuantity':
      return cart
        .filter((item) =>
          !sameItem(item, action.item) || item.type !== 'product' || itemLimit(item) > 0
        )
        .map((item) =>
          sameItem(item, action.item)
            ? {
                ...item,
                quantity: Math.min(itemLimit(item), Math.max(1, item.quantity + action.delta)),
              }
            : item
        );
    case 'remove':
      return cart.filter((item) => !sameItem(item, action.item));
    case 'clear':
      return [];
    case 'replace':
      return action.items.filter((item) =>
        item.type !== 'product' || Number(item.stock_quantity) > 0
      );
    default:
      return cart;
  }
};

// Предоставляет компонентам сайта состояние корзины и операции над ней.
export const CartProvider = ({ children }) => {
  const [cart, dispatch] = useReducer(cartReducer, []);
  const addItem = useCallback((item) => dispatch({ type: 'add', item }), [dispatch]);
  const changeQuantity = useCallback(
    (item, delta) => dispatch({ type: 'changeQuantity', item, delta }),
    [dispatch]
  );
  const removeItem = useCallback((item) => dispatch({ type: 'remove', item }), [dispatch]);
  const clearCart = useCallback(() => dispatch({ type: 'clear' }), [dispatch]);
  const replaceCart = useCallback((items) => dispatch({ type: 'replace', items }), [dispatch]);

  const value = useMemo(
    () => ({ cart, addItem, changeQuantity, removeItem, clearCart, replaceCart }),
    [cart, addItem, changeQuantity, removeItem, clearCart, replaceCart]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
};
