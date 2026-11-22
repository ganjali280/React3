import { useEffect, useState } from 'react';
import { deleteAdminReview, getAdminReviews } from '../api/client';

// Показывает администратору отзывы и позволяет удалять нарушающие правила.
export const AdminReviewManager = ({ admin }) => {
  const [reviews, setReviews] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    getAdminReviews(admin.user_id)
      .then((result) => {
        if (active) setReviews(result);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || 'Не удалось загрузить отзывы');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [admin.user_id, refreshKey]);

  // Удаляет отзыв после подтверждения администратора.
  const remove = async (review) => {
    if (!window.confirm(`Удалить отзыв пользователя ${review.user_name} за нарушение правил?`)) return;
    setError('');
    try {
      await deleteAdminReview(admin.user_id, review.review_id, review.item_type);
      setRefreshKey((value) => value + 1);
    } catch (requestError) {
      setError(requestError.message || 'Не удалось удалить отзыв');
    }
  };

  const normalizedQuery = query.trim().toLocaleLowerCase('ru-RU');
  const visibleReviews = reviews.filter((review) =>
    [
      review.item_name,
      review.item_type,
      review.user_name,
      review.user_email,
      review.is_removed ? 'Отзыв удалён за нарушение политики' : review.comment,
    ]
      .some((value) => String(value || '').toLocaleLowerCase('ru-RU').includes(normalizedQuery))
  );

  return (
    <section className="admin-form admin-review-manager">
      <h3>Отзывы товаров и услуг</h3>
      <p className="muted-copy">Все отзывы доступны для просмотра. Удаляйте только отзывы, нарушающие правила.</p>
      {loading && <p className="muted-copy">Загрузка отзывов…</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <label className="admin-search">
        Поиск по товару/услуге, автору или тексту отзыва
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Название товара или услуги, email или текст"
        />
      </label>
      <div className="admin-catalog-list">
        {visibleReviews.map((review) => (
          <article className="admin-review-row" key={`${review.item_type}-${review.review_id}`}>
            <div>
              <strong>{review.item_name} ({review.item_type === 'product' ? 'товар' : 'услуга'}) · {review.user_name}</strong>
              <small>{review.user_email} · {review.rating}/5 · {new Date(review.created_at).toLocaleString('ru-RU')}</small>
              {review.is_removed ? (
                <p>Отзыв удалён за нарушение политики</p>
              ) : review.comment && (
                <p>{review.comment}</p>
              )}
            </div>
            {!review.is_removed && (
              <div className="admin-catalog-actions">
                <button className="text-button danger-text" type="button" onClick={() => remove(review)}>
                  Удалить за нарушение политики
                </button>
              </div>
            )}
          </article>
        ))}
        {!loading && visibleReviews.length === 0 && (
          <p className="muted-copy">Отзывы не найдены</p>
        )}
      </div>
    </section>
  );
};
