import { useState } from 'react';

export const AsideCategories = ({
  categories,
  selectedCategories,
  onToggleCategory,
  onAddCategory,
  isAdmin,
}) => {
  const [name, setName] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    await onAddCategory(name.trim());
    setName('');
  };

  return (
    <aside className="category-sidebar">
      <h2>Категории</h2>
      {categories.map((cat) => (
        <label key={cat.category_id} className="category-option">
          <input
            type="checkbox"
            checked={selectedCategories.includes(cat.category_id)}
            onChange={() => onToggleCategory(cat.category_id)}
          />
          <span>{cat.name}</span>
        </label>
      ))}

      {isAdmin && (
        <form className="admin-form" onSubmit={handleSubmit}>
          <h3>Новая категория</h3>
          <input
            type="text"
            placeholder="Название"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="button button-outline" type="submit">
            Добавить
          </button>
        </form>
      )}
    </aside>
  );
};
