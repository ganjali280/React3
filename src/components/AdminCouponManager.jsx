import { useEffect, useMemo, useState } from 'react';
import {
  createAdminCoupon,
  deleteAdminCoupon,
  getAdminCoupons,
  updateAdminCoupon,
} from '../api/client';
import { containsProhibitedText } from '../validation';

const emptyCoupon = {
  coupon_id: null,
  code: '',
  percent: '10',
  usage_type: 'multi_use',
  audience: 'selected_only',
  assigned_user_ids: [],
  is_active: true,
  expires_at: '',
  min_order: '0',
};

// Преобразует дату купона в формат поля ввода даты и времени.
const toLocalDateTime = (value) => {
  if (!value) return '';
  const date = new Date(value);
  // Добавляет ведущий ноль к числовой части даты.
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

// Определяет поле формы, к которому относится ошибка купона.
const fieldForCouponError = (message) => {
  const normalized = String(message || '').toLocaleLowerCase('ru-RU');
  if (normalized.includes('код') || normalized.includes('купоном с таким')) return 'code';
  if (normalized.includes('скидк')) return 'percent';
  if (normalized.includes('клиент')) return 'assigned_user_ids';
  if (normalized.includes('минимальн')) return 'min_order';
  if (normalized.includes('срок')) return 'expires_at';
  return null;
};

// Позволяет создавать, назначать и редактировать купоны в панели администратора.
export const AdminCouponManager = ({ admin, clients = [], onCouponsChanged }) => {
  const [coupons, setCoupons] = useState([]);
  const [form, setForm] = useState(emptyCoupon);
  const [query, setQuery] = useState('');
  const [clientQuery, setClientQuery] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});

  // Загружает купоны администратора и обновляет связанные данные.
  const loadCoupons = async () => {
    const result = await getAdminCoupons(admin.user_id);
    setCoupons(result);
    await onCouponsChanged?.();
  };

  useEffect(() => {
    let active = true;
    getAdminCoupons(admin.user_id)
      .then((result) => {
        if (active) {
          setCoupons(result);
        }
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || 'Не удалось загрузить купоны');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [admin.user_id]);

  const visibleCoupons = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase('ru-RU');
    return coupons.filter((coupon) =>
      !normalizedQuery ||
      coupon.code.toLocaleLowerCase('ru-RU').includes(normalizedQuery)
    );
  }, [coupons, query]);
  const visibleClients = useMemo(() => {
    const normalizedQuery = clientQuery.trim().toLocaleLowerCase('ru-RU');
    return clients.filter((client) =>
      !normalizedQuery ||
      [client.name, client.email]
        .some((value) => String(value || '').toLocaleLowerCase('ru-RU').includes(normalizedQuery))
    );
  }, [clients, clientQuery]);

  // Обновляет поля формы и сбрасывает связанные сообщения об ошибках.
  const updateForm = (updates) => {
    setError('');
    setMessage('');
    setFieldErrors((current) => {
      const next = { ...current };
      Object.keys(updates).forEach((key) => delete next[key]);
      return next;
    });
    setForm((current) => ({ ...current, ...updates }));
  };

  // Проверяет и сохраняет купон с его назначениями и настройками.
  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    setFieldErrors({});
    const code = form.code.trim();
    if (!/^[A-Za-z0-9_-]{3,50}$/.test(code)) {
      setFieldErrors({ code: 'Введите 3–50 латинских букв, цифр, дефисов или подчёркиваний' });
      return;
    }
    if (containsProhibitedText(form.code)) {
      setFieldErrors({ code: 'Код купона содержит недопустимые слова' });
      return;
    }
    if (!Number.isInteger(Number(form.percent)) || Number(form.percent) < 1 || Number(form.percent) > 99) {
      setFieldErrors({ percent: 'Укажите целое число от 1 до 99%' });
      return;
    }
    if (!Number.isFinite(Number(form.min_order)) ||
        Number(form.min_order) < 0 ||
        Number(form.min_order) > 100000000) {
      setFieldErrors({ min_order: 'Сумма должна быть от 0 до 100 000 000 ₽' });
      return;
    }
    if (form.expires_at && Number.isNaN(new Date(form.expires_at).getTime())) {
      setFieldErrors({ expires_at: 'Укажите корректный срок действия' });
      return;
    }
    if (form.audience === 'selected_only' && form.assigned_user_ids.length === 0) {
      setFieldErrors({ assigned_user_ids: 'Выберите хотя бы одного клиента' });
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    const payload = {
      code: form.code.trim(),
      percent: Number(form.percent),
      usage_type: form.usage_type,
      assigned_user_ids: form.audience === 'selected_only' ? form.assigned_user_ids : [],
      is_active: form.is_active,
      expires_at: form.expires_at || null,
      min_order: Number(form.min_order),
    };
    try {
      if (form.coupon_id) {
        await updateAdminCoupon(admin.user_id, form.coupon_id, payload);
        setMessage('Купон обновлён');
      } else {
        await createAdminCoupon(admin.user_id, payload);
        setMessage('Купон создан');
      }
      setForm(emptyCoupon);
      await loadCoupons();
    } catch (requestError) {
      const field = fieldForCouponError(requestError.message);
      if (field) {
        setFieldErrors({ [field]: requestError.message });
      } else {
        setError(requestError.message || 'Не удалось сохранить купон');
      }
    } finally {
      setSaving(false);
    }
  };

  // Удаляет купон после подтверждения администратора.
  const remove = async (coupon) => {
    if (!window.confirm(`Удалить купон «${coupon.code}»?`)) return;
    setError('');
    setMessage('');
    try {
      await deleteAdminCoupon(admin.user_id, coupon.coupon_id);
      setMessage('Купон удалён');
      await loadCoupons();
    } catch (requestError) {
      setError(requestError.message || 'Не удалось удалить купон');
    }
  };

  return (
    <section className="admin-form admin-coupon-manager">
      <h3>Управление купонами</h3>
      {error && <p className="form-error" role="alert">{error}</p>}
      {message && <p className="success-message" role="status">{message}</p>}
      <form
        className="admin-catalog-form admin-managed-coupon-form"
        onSubmit={submit}
        noValidate
      >
        <label>
          Код купона
          <input
            value={form.code}
            onChange={(event) => updateForm({ code: event.target.value })}
            minLength={3}
            maxLength={50}
            pattern="[A-Za-z0-9_-]{3,50}"
            required
            aria-invalid={Boolean(fieldErrors.code)}
            aria-describedby={fieldErrors.code ? 'admin-coupon-code-error' : undefined}
          />
          {fieldErrors.code && <small className="field-error" id="admin-coupon-code-error">{fieldErrors.code}</small>}
        </label>
        <label>
          Скидка (1–99%)
          <input
            type="number"
            min="1"
            max="99"
            step="1"
            value={form.percent}
            onChange={(event) => updateForm({ percent: event.target.value })}
            required
            aria-invalid={Boolean(fieldErrors.percent)}
            aria-describedby={fieldErrors.percent ? 'admin-coupon-percent-error' : undefined}
          />
          {fieldErrors.percent && <small className="field-error" id="admin-coupon-percent-error">{fieldErrors.percent}</small>}
        </label>
        <label>
          Использование
          <select
            value={form.usage_type}
            onChange={(event) => updateForm({ usage_type: event.target.value })}
          >
            <option value="one_time">Одноразовый</option>
            <option value="multi_use">Многоразовый</option>
          </select>
          <small className="coupon-field-help">
            {form.usage_type === 'one_time'
              ? form.audience === 'selected_only'
                ? 'Каждый выбранный клиент сможет применить купон один раз.'
                : 'После первого успешного заказа купон станет недоступен всем.'
              : 'Купон можно применять повторно, пока он активен и не истёк.'}
          </small>
        </label>
        <label>
          Кому доступен купон
          <select
            value={form.audience}
            onChange={(event) => updateForm({ audience: event.target.value })}
          >
            <option value="selected_only">Только выбранным клиентам</option>
            <option value="all_clients">Всем клиентам</option>
          </select>
        </label>
        {form.audience === 'selected_only' && (
          <div className="admin-coupon-assignment">
            <label className="admin-search">
              Поиск клиента по имени или email
              <input
                type="search"
                value={clientQuery}
                onChange={(event) => setClientQuery(event.target.value)}
                placeholder="Имя или email"
              />
            </label>
            <div className="admin-user-selection" aria-describedby={fieldErrors.assigned_user_ids ? 'admin-coupon-assignment-error' : undefined}>
              <div className="admin-user-selection-toolbar">
                <span>Выбрано клиентов: {form.assigned_user_ids.length}</span>
                <div>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => updateForm({
                      assigned_user_ids: [...new Set([
                        ...form.assigned_user_ids,
                        ...visibleClients.map((client) => client.user_id),
                      ])],
                    })}
                  >
                    Выбрать найденных
                  </button>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => updateForm({ assigned_user_ids: [] })}
                  >
                    Снять выбор
                  </button>
                </div>
              </div>
              <div className="admin-user-list" role="group" aria-label="Выберите клиентов для купона">
                {visibleClients.length === 0 ? (
                  <p className="muted-copy">Клиенты не найдены</p>
                ) : (
                  visibleClients.map((client) => (
                    <label className="admin-user-option" key={client.user_id}>
                      <input
                        type="checkbox"
                        checked={form.assigned_user_ids.includes(client.user_id)}
                        onChange={(event) => updateForm({
                          assigned_user_ids: event.target.checked
                            ? [...form.assigned_user_ids, client.user_id]
                            : form.assigned_user_ids.filter((id) => id !== client.user_id),
                        })}
                      />
                      <span>
                        <strong>{client.name}</strong>
                        <small>{client.email}</small>
                      </span>
                    </label>
                  ))
                )}
              </div>
            </div>
            {fieldErrors.assigned_user_ids && (
              <small className="field-error" id="admin-coupon-assignment-error">
                {fieldErrors.assigned_user_ids}
              </small>
            )}
          </div>
        )}
        <label>
          Минимальная сумма заказа
          <input
            type="number"
            min="0"
            max="100000000"
            step="0.01"
            value={form.min_order}
            onChange={(event) => updateForm({ min_order: event.target.value })}
            required
            aria-invalid={Boolean(fieldErrors.min_order)}
            aria-describedby={fieldErrors.min_order ? 'admin-coupon-min-order-error' : undefined}
          />
          {fieldErrors.min_order && <small className="field-error" id="admin-coupon-min-order-error">{fieldErrors.min_order}</small>}
          <small className="coupon-field-help">
            Сумма указана в рублях и не задаёт число применений.
          </small>
        </label>
        <label>
          Действует до (необязательно)
          <input
            type="datetime-local"
            value={form.expires_at}
            onChange={(event) => updateForm({ expires_at: event.target.value })}
            aria-invalid={Boolean(fieldErrors.expires_at)}
            aria-describedby={fieldErrors.expires_at ? 'admin-coupon-expires-error' : undefined}
          />
          {fieldErrors.expires_at && <small className="field-error" id="admin-coupon-expires-error">{fieldErrors.expires_at}</small>}
        </label>
        <label className="admin-coupon-active">
          <input
            type="checkbox"
            checked={form.is_active}
            onChange={(event) => updateForm({ is_active: event.target.checked })}
          />
          Активен
        </label>
        <div className="admin-catalog-actions">
          <button type="submit" className="button button-outline" disabled={saving}>
            {saving ? 'Сохраняем…' : form.coupon_id ? 'Сохранить купон' : 'Создать купон'}
          </button>
          {form.coupon_id && (
            <button
              type="button"
              className="button button-outline"
              onClick={() => {
                setError('');
                setMessage('');
                setForm(emptyCoupon);
              }}
            >
              Отмена
            </button>
          )}
        </div>
      </form>

      <label className="admin-search">
        Поиск купона по коду
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Введите код"
        />
      </label>
      {loading && <p className="muted-copy">Загрузка купонов…</p>}
      <div className="admin-managed-coupon-grid">
        {visibleCoupons.map((coupon) => {
          const usesCount = Number(coupon.uses_count) || 0;
          const assignedCount = Number(coupon.assigned_user_ids?.length) || 0;
          const assignedUsesCount = Number(coupon.assigned_uses_count) || 0;
          const isExpired = coupon.expires_at && new Date(coupon.expires_at) <= new Date();
          const isExhausted = coupon.usage_type === 'one_time' &&
            (assignedCount > 0 ? assignedUsesCount >= assignedCount : usesCount > 0);
          const status = !coupon.is_active
            ? 'Отключён'
            : isExpired
              ? 'Истёк'
              : isExhausted
                ? 'Исчерпан'
                : 'Доступен';
          const usesSummary = coupon.usage_type === 'one_time'
            ? assignedCount > 0
              ? `использовано: ${assignedUsesCount}/${assignedCount} клиентов`
              : `использовано: ${usesCount > 0 ? 1 : 0}/1`
            : `использовано: ${usesCount}`;

          return (
            <article className="admin-managed-coupon-card" key={coupon.coupon_id}>
              <div className="admin-managed-coupon-top">
                <span className="admin-user-coupon-icon" aria-hidden="true">%</span>
                <span className={`admin-user-coupon-status${status === 'Доступен' ? ' active' : ''}`}>
                  {status}
                </span>
              </div>
              <div className="admin-managed-coupon-details">
                <strong>{coupon.code} · −{coupon.percent}%</strong>
                <small>
                  {coupon.usage_type === 'one_time' ? 'Одноразовый' : 'Многоразовый'} ·{' '}
                  {usesSummary} ·{' '}
                  {assignedCount > 0 ? `назначен клиентам: ${assignedCount}` : 'доступен всем'}
                </small>
                <small>Минимальный заказ: {coupon.min_order} ₽</small>
                {coupon.expires_at && (
                  <small>Действует до {new Date(coupon.expires_at).toLocaleString('ru-RU')}</small>
                )}
              </div>
              <div className="admin-catalog-actions admin-managed-coupon-actions">
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    setError('');
                    setMessage('');
                    setForm({
                      coupon_id: coupon.coupon_id,
                      code: coupon.code,
                      percent: String(coupon.percent),
                      usage_type: coupon.usage_type,
                      audience: coupon.assigned_user_ids?.length > 0 ? 'selected_only' : 'all_clients',
                      assigned_user_ids: coupon.assigned_user_ids || [],
                      is_active: coupon.is_active,
                      expires_at: toLocalDateTime(coupon.expires_at),
                      min_order: String(coupon.min_order),
                    });
                  }}
                >
                  Изменить
                </button>
                <button
                  type="button"
                  className="text-button danger-text"
                  onClick={() => remove(coupon)}
                >
                  Удалить
                </button>
              </div>
            </article>
          );
        })}
        {!loading && visibleCoupons.length === 0 && (
          <p className="muted-copy">Купоны не найдены</p>
        )}
      </div>
    </section>
  );
};
