import { useState, useEffect } from 'react';
import { ThemeContext } from './themeContextValue';

const STORAGE_KEY = 'fec-theme';

// Читает сохранённую тему из браузера.
const readStoredTheme = () => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
};

// Сохраняет выбранную тему в браузере.
const writeStoredTheme = (value) => {
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    return false;
  }
  return true;
};

// Выбирает сохранённую тему или светлую тему по умолчанию.
const getInitialTheme = () => {
  const savedTheme = readStoredTheme();
  return savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'light';
};

// Предоставляет выбранную тему и переключатель дочерним компонентам.
export const ThemeProvider = ({ children }) => {
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    writeStoredTheme(theme);
  }, [theme]);

  // Переключает оформление между светлой и тёмной темами.
  const toggleTheme = () =>
    setTheme((currentTheme) => (currentTheme === 'light' ? 'dark' : 'light'));

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
};
