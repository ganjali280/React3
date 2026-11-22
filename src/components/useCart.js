import { useContext } from 'react';
import { CartContext } from './cartContextValue';

// Возвращает состояние корзины и её действия из контекста.
export const useCart = () => {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart must be used within CartProvider');
  return context;
};
