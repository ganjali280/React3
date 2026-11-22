import { useContext } from 'react';
import { ThemeContext } from './themeContextValue';

// Возвращает выбранную тему и переключатель из контекста.
export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used within ThemeProvider');
  return context;
};
