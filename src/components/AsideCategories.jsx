// Показывает фильтр категорий и передаёт выбранные значения родительскому компоненту.
export const AsideCategories = ({ categories, selectedCategories, onToggleCategory }) => {
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

    </aside>
  );
};
