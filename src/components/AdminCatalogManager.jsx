import { useState } from 'react';
import { createCatalogItem, deleteCatalogItem, updateCatalogItem } from '../api/client';
import { containsProhibitedText } from '../validation';
import { getServiceImage } from './serviceImages';

const emptyForm = {
  type: 'product',
  id: null,
  name: '',
  description: '',
  category_id: '',
  price: '',
  duration: '',
  image_url: '',
  stock_quantity: '100',
};

// Возвращает идентификатор товара или услуги.
const getItemId = (item, type) => type === 'service' ? item.service_id : item.product_id;

// Позволяет администратору создавать, изменять, искать и удалять позиции каталога.
export const AdminCatalogManager = ({ admin, products, services, categories, onChanged }) => {
  const [form, setForm] = useState(emptyForm);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // Заполняет форму данными выбранной позиции для редактирования.
  const startEditing = (item, type) => {
    setError('');
    setMessage('');
    setForm({
      type,
      id: getItemId(item, type),
      name: item.name || '',
      description: item.description || '',
      category_id: String(item.category_id || ''),
      price: String(item.price ?? ''),
      duration: type === 'service' ? String(item.duration ?? '') : '',
      image_url: type === 'service' ? getServiceImage(item) : item.image_url || '',
      stock_quantity: type === 'product' ? String(item.stock_quantity ?? 100) : '100',
    });
  };

  // Очищает форму и завершает редактирование.
  const clearForm = () => {
    setForm({ ...emptyForm, type: form.type });
    setError('');
  };

  // Проверяет и сохраняет новую или изменённую позицию каталога.
  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      category_id: form.category_id ? Number(form.category_id) : null,
      price: Number(form.price),
      image_url: form.image_url.trim(),
      ...(form.type === 'product' ? { stock_quantity: Number(form.stock_quantity) } : {}),
      ...(form.type === 'service' ? { duration: Number(form.duration) } : {}),
    };

    if (!payload.name || !Number.isFinite(payload.price) || payload.price <= 0) {
      setError('Заполните название и укажите цену больше 0');
      return;
    }
    if (containsProhibitedText(payload.name) || containsProhibitedText(payload.description)) {
      setError('Название или описание содержит недопустимые слова');
      return;
    }
    if (
      form.type === 'product' &&
      (!Number.isInteger(payload.stock_quantity) || payload.stock_quantity < 0)
    ) {
      setError('Укажите остаток на складе целым числом от 0');
      return;
    }

    setSaving(true);
    try {
      if (form.id) {
        await updateCatalogItem(admin.user_id, form.type, form.id, payload);
        setMessage('Изменения сохранены');
      } else {
        await createCatalogItem(admin.user_id, form.type, payload);
        setMessage('Позиция добавлена в каталог');
      }
      setForm({ ...emptyForm, type: form.type });
      onChanged();
    } catch (requestError) {
      setError(requestError.message || 'Не удалось сохранить позицию');
    } finally {
      setSaving(false);
    }
  };

  // Удаляет позицию каталога после подтверждения администратора.
  const handleDelete = async (item, type) => {
    const itemId = getItemId(item, type);
    if (!window.confirm(`Удалить «${item.name}» из каталога?`)) return;
    setError('');
    setMessage('');
    try {
      await deleteCatalogItem(admin.user_id, type, itemId);
      setMessage('Позиция удалена');
      if (form.id === itemId && form.type === type) clearForm();
      onChanged();
    } catch (requestError) {
      setError(requestError.message || 'Не удалось удалить позицию');
    }
  };

  const normalizedQuery = query.trim().toLocaleLowerCase('ru-RU');
  const catalogItems = [
    ...products.map((item) => ({ ...item, type: 'product' })),
    ...services.map((item) => ({
      ...item,
      image_url: getServiceImage(item),
      type: 'service',
    })),
  ].filter((item) => {
    if (!normalizedQuery) return true;
    const category = categories.find((entry) => entry.category_id === item.category_id)?.name;
    return [item.name, item.description, category]
      .some((value) => String(value || '').toLocaleLowerCase('ru-RU').includes(normalizedQuery));
  });

  return (
    <section className="admin-form admin-catalog-manager">
      <h3>Управление товарами и услугами</h3>
      <form className="admin-catalog-form" onSubmit={handleSubmit}>
        <label>
          Тип позиции
          <select
            value={form.type}
            onChange={(event) => setForm({ ...emptyForm, type: event.target.value })}
          >
            <option value="product">Товар</option>
            <option value="service">Услуга</option>
          </select>
        </label>
        <label>
          Название
          <input
            value={form.name}
            onChange={(event) => setForm({ ...form, name: event.target.value })}
            maxLength={150}
            required
          />
        </label>
        <label>
          Категория
          <select
            value={form.category_id}
            onChange={(event) => setForm({ ...form, category_id: event.target.value })}
          >
            <option value="">Без категории</option>
            {categories.map((category) => (
              <option value={category.category_id} key={category.category_id}>{category.name}</option>
            ))}
          </select>
        </label>
        <label>
          Цена
          <input
            type="number"
            min="0.01"
            max="100000000"
            step="0.01"
            value={form.price}
            onChange={(event) => setForm({ ...form, price: event.target.value })}
            required
          />
        </label>
        {form.type === 'product' && (
          <label>
            Остаток на складе
            <input
              type="number"
              min="0"
              max="100000"
              step="1"
              value={form.stock_quantity}
              onChange={(event) => setForm({ ...form, stock_quantity: event.target.value })}
              required
            />
          </label>
        )}
        {form.type === 'service' && (
          <label>
            Длительность (минут)
            <input
              type="number"
              min="1"
              max="1440"
              step="1"
              value={form.duration}
              onChange={(event) => setForm({ ...form, duration: event.target.value })}
              required
            />
          </label>
        )}
        <label>
          Ссылка на изображение
          <input
            type="url"
            maxLength={2000}
            value={form.image_url}
            onChange={(event) => setForm({ ...form, image_url: event.target.value })}
          />
        </label>
        {form.image_url && (
          <div className="admin-image-preview">
            <img src={form.image_url} alt="Предпросмотр изображения" />
            <button
              type="button"
              className="text-button danger-text"
              onClick={() => setForm({ ...form, image_url: '' })}
            >
              Удалить изображение
            </button>
          </div>
        )}
        <label className="admin-catalog-description">
          Описание
          <textarea
            value={form.description}
            maxLength={5000}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
            rows={3}
          />
        </label>
        <div className="admin-catalog-actions">
          <button type="submit" className="button button-outline" disabled={saving}>
            {saving ? 'Сохраняем…' : form.id ? 'Сохранить изменения' : 'Добавить позицию'}
          </button>
          {form.id && (
            <button type="button" className="button button-outline" onClick={clearForm}>
              Отмена
            </button>
          )}
        </div>
      </form>
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="success-message" role="status">{message}</p>}

      <label className="admin-search">
        Поиск позиции каталога по названию, описанию или категории
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Название или категория"
        />
      </label>
      <div className="admin-catalog-list">
        {catalogItems.map((item) => (
          <article className="admin-catalog-row" key={`${item.type}-${getItemId(item, item.type)}`}>
            {item.image_url ? (
              <img className="admin-catalog-image" src={item.image_url} alt={item.name} />
            ) : (
              <div className="admin-catalog-image admin-catalog-image-placeholder">
                {item.type === 'service' ? 'Услуга' : 'Товар'}
              </div>
            )}
            <div>
              <strong>{item.name}</strong>
              <small>
                {item.type === 'service' ? 'Услуга' : 'Товар'} · {item.price} ₽ ·{' '}
                {categories.find((category) => category.category_id === item.category_id)?.name || 'Без категории'}
              </small>
            </div>
            <div className="admin-catalog-actions">
              <button
                type="button"
                className="text-button"
                onClick={() => startEditing(item, item.type)}
              >
                Изменить
              </button>
              <button
                type="button"
                className="text-button danger-text"
                onClick={() => handleDelete(item, item.type)}
              >
                Удалить
              </button>
            </div>
          </article>
        ))}
        {catalogItems.length === 0 && <p className="muted-copy">Позиции не найдены</p>}
      </div>
    </section>
  );
};
