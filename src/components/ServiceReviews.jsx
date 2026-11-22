import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  getProductReviewOrders,
  getProductReviews,
  getServiceReviewEligibility,
  getServiceReviews,
  deleteAdminReview,
  deleteMyReview,
  saveProductReview,
  saveServiceReview,
  updateMyReview,
} from '../api/client';
import { containsProhibitedText } from '../validation';

// Загружает отзывы и проверяет права пользователя на их создание и изменение.
export const ServiceReviews = ({ serviceId, itemName, user, type = 'service' }) => {
  const [reviews, setReviews] = useState([]);
  const [rating, setRating] = useState('5');
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [reviewsLoaded, setReviewsLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showReviews, setShowReviews] = useState(false);
  const [editingReviewId, setEditingReviewId] = useState(null);
  const [editRating, setEditRating] = useState('5');
  const [editComment, setEditComment] = useState('');
  const [reviewOrdersResult, setReviewOrdersResult] = useState({ key: '', orders: [] });
  const [serviceEligibilityResult, setServiceEligibilityResult] = useState({
    key: '',
    canReview: false,
  });
  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);
  const reviewOrderKey = `${serviceId}:${type}:${user?.user_id ?? ''}:${refreshKey}`;
  const reviewOrders = reviewOrdersResult.key === reviewOrderKey
    ? reviewOrdersResult.orders
    : [];
  const reviewOrdersLoading = type === 'product' &&
    user?.role === 'client' &&
    reviewOrdersResult.key !== reviewOrderKey;
  const serviceEligibilityLoading = type !== 'product' &&
    user?.role === 'client' &&
    serviceEligibilityResult.key !== reviewOrderKey;
  const canReviewService =
    serviceEligibilityResult.key === reviewOrderKey &&
    serviceEligibilityResult.canReview;

  useEffect(() => {
    let active = true;
    (type === 'product' ? getProductReviews(serviceId) : getServiceReviews(serviceId))
      .then((result) => {
        if (active) {
          setReviews(result);
          setReviewsLoaded(true);
        }
      })
      .catch((requestError) => {
        if (active) setError(requestError.message || 'Не удалось загрузить отзывы');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    if (type === 'product' && user?.role === 'client') {
      getProductReviewOrders(serviceId)
        .then((orders) => {
          if (active) setReviewOrdersResult({ key: reviewOrderKey, orders });
        })
        .catch((requestError) => {
          if (active) {
            setError(requestError.message || 'Не удалось проверить покупки');
            setReviewOrdersResult({ key: reviewOrderKey, orders: [] });
          }
        });
    } else if (type !== 'product' && user?.role === 'client') {
      getServiceReviewEligibility(serviceId)
        .then((result) => {
          if (active) {
            setServiceEligibilityResult({
              key: reviewOrderKey,
              canReview: result.can_review,
            });
          }
        })
        .catch((requestError) => {
          if (active) {
            setError(requestError.message || 'Не удалось проверить покупку услуги');
            setServiceEligibilityResult({ key: reviewOrderKey, canReview: false });
          }
        });
    }

    return () => {
      active = false;
    };
  }, [serviceId, refreshKey, type, user?.user_id, user?.role, reviewOrderKey]);

  // Повторно загружает отзывы и связанные с ними данные.
  const reload = () => {
    setError('');
    setLoading(true);
    setRefreshKey((current) => current + 1);
  };

  // Проверяет данные и отправляет новый отзыв.
  const submitReview = async (event) => {
    event.preventDefault();
    setError('');
    const trimmedComment = comment.trim();
    if (!trimmedComment) {
      setError('Введите текст отзыва');
      return;
    }
    if (containsProhibitedText(trimmedComment)) {
      setError('Отзыв содержит недопустимые слова');
      return;
    }
    setSaving(true);
    try {
      const payload = { rating: Number(rating), comment: trimmedComment };
      if (type === 'product') {
        if (!selectedReviewOrderId) {
          setError('Выберите выполненный заказ с этим товаром');
          return;
        }
        payload.order_id = Number(selectedReviewOrderId);
        await saveProductReview(user.user_id, serviceId, payload);
      } else {
        await saveServiceReview(user.user_id, serviceId, payload);
      }
      setComment('');
      reload();
    } catch (requestError) {
      setError(requestError.message || 'Не удалось сохранить отзыв');
    } finally {
      setSaving(false);
    }
  };

  // Открывает форму редактирования выбранного отзыва.
  const startEditingReview = (review) => {
    setEditingReviewId(review.review_id);
    setEditRating(String(review.rating));
    setEditComment(review.comment || '');
    setError('');
  };

  // Проверяет изменения и сохраняет отзыв.
  const saveEditedReview = async (event) => {
    event.preventDefault();
    setError('');
    const trimmedComment = editComment.trim();
    if (!trimmedComment) {
      setError('Введите текст отзыва');
      return;
    }
    if (containsProhibitedText(trimmedComment)) {
      setError('Отзыв содержит недопустимые слова');
      return;
    }
    setSaving(true);
    try {
      await updateMyReview(user.user_id, type, editingReviewId, {
        rating: Number(editRating),
        comment: trimmedComment,
      });
      setEditingReviewId(null);
      reload();
    } catch (requestError) {
      setError(requestError.message || 'Не удалось изменить отзыв');
    } finally {
      setSaving(false);
    }
  };

  // Удаляет собственный отзыв клиента.
  const deleteOwnReview = async (reviewId) => {
    if (!window.confirm('Удалить ваш отзыв?')) return;
    setError('');
    setSaving(true);
    try {
      await deleteMyReview(user.user_id, type, reviewId);
      setEditingReviewId(null);
      reload();
    } catch (requestError) {
      setError(requestError.message || 'Не удалось удалить отзыв');
    } finally {
      setSaving(false);
    }
  };

  // Удаляет отзыв администратором за нарушение правил.
  const deleteReviewAsAdmin = async (reviewId) => {
    if (!window.confirm('Удалить отзыв за нарушение политики?')) return;
    setError('');
    setSaving(true);
    try {
      await deleteAdminReview(user.user_id, reviewId, type);
      setEditingReviewId(null);
      reload();
    } catch (requestError) {
      setError(requestError.message || 'Не удалось удалить отзыв');
    } finally {
      setSaving(false);
    }
  };

  const selectedReviewOrderId = reviewOrders.some(
    (order) => String(order.order_id) === selectedOrderId
  )
    ? selectedOrderId
    : String(reviewOrders[0]?.order_id ?? '');
  const activeReviews = reviews.filter((review) => !review.is_removed);
  const hasOwnReview = reviews.some((review) => review.is_own);
  const canSubmitReview = user?.role === 'client' && (
    type === 'product'
      ? !reviewOrdersLoading && reviewOrders.length > 0
      : !serviceEligibilityLoading && canReviewService
  ) && reviewsLoaded && !hasOwnReview && editingReviewId === null;
  const averageRating = activeReviews.length
    ? activeReviews.reduce((total, review) => total + Number(review.rating), 0) / activeReviews.length
    : 0;

  const titleId = `reviews-title-${type}-${serviceId}`;

  return (
    <>
      <button
        className="button button-outline product-button"
        type="button"
        onClick={() => setShowReviews(true)}
      >
        Отзывы
      </button>
      {showReviews && createPortal(
        <div className="modal-overlay" onClick={() => setShowReviews(false)}>
          <div
            className="modal-content"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id={titleId}>Отзывы: {itemName || (type === 'product' ? 'товар' : 'услуга')}</h3>
            <div className="service-reviews">
      {reviewsLoaded && (
        <p className="muted-copy">
          {activeReviews.length
            ? `Рейтинг: ${averageRating.toFixed(1)} из 5 · отзывов: ${activeReviews.length}`
            : 'Рейтинг: пока нет отзывов'}
        </p>
      )}
      {loading && <p className="muted-copy">Загрузка отзывов…</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {!loading && !error && reviews.length === 0 && <p className="muted-copy">Отзывов пока нет</p>}
      {reviews.map((review) => (
        <article className="service-review" key={review.review_id}>
          <strong>{review.user_name}</strong>
          {editingReviewId === review.review_id && !review.is_removed ? (
            <form className="review-form" onSubmit={saveEditedReview}>
              <label>
                Оценка
                <select value={editRating} onChange={(event) => setEditRating(event.target.value)}>
                  {[5, 4, 3, 2, 1].map((value) => (
                    <option key={value} value={value}>{value} из 5</option>
                  ))}
                </select>
              </label>
              <label>
                Комментарий
                <textarea
                  value={editComment}
                  onChange={(event) => setEditComment(event.target.value)}
                  required
                  maxLength={1000}
                />
              </label>
              <button className="button button-outline" type="submit" disabled={saving}>
                {saving ? 'Сохранение…' : 'Сохранить изменения'}
              </button>
              <button
                className="button button-outline"
                type="button"
                disabled={saving}
                onClick={() => setEditingReviewId(null)}
              >
                Отмена
              </button>
            </form>
          ) : (
            <>
              <span aria-label={`Оценка ${review.rating} из 5`}>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</span>
              {review.is_removed ? (
                <p>Отзыв удалён за нарушение политики</p>
              ) : review.comment && (
                <p>{review.comment}</p>
              )}
              {review.is_own && user?.role === 'client' && !review.is_removed && (
                <div className="review-actions">
                  <button
                    className="button button-outline"
                    type="button"
                    disabled={saving}
                    onClick={() => startEditingReview(review)}
                  >
                    Изменить
                  </button>
                  <button
                    className="button button-outline"
                    type="button"
                    disabled={saving}
                    onClick={() => deleteOwnReview(review.review_id)}
                  >
                    Удалить
                  </button>
                </div>
              )}
              {user?.role === 'admin' && !review.is_removed && (
                <div className="review-actions">
                  <button
                    className="button button-outline"
                    type="button"
                    disabled={saving}
                    onClick={() => deleteReviewAsAdmin(review.review_id)}
                  >
                    Удалить за нарушение политики
                  </button>
                </div>
              )}
            </>
          )}
          <small>{new Date(review.created_at).toLocaleDateString('ru-RU')}</small>
        </article>
      ))}
      {type === 'product' && user?.role === 'client' && reviewOrdersLoading && (
        <p className="muted-copy">Проверяем выполненные заказы…</p>
      )}
      {type === 'product' && user?.role === 'client' && reviewsLoaded && !hasOwnReview && !reviewOrdersLoading && !error && reviewOrders.length === 0 && (
        <p className="muted-copy">Оставить отзыв можно после оплаты и выполнения заказа с этим товаром.</p>
      )}
      {type !== 'product' && user?.role === 'client' && serviceEligibilityLoading && (
        <p className="muted-copy">Проверяем выполненные услуги…</p>
      )}
      {type !== 'product' && user?.role === 'client' && reviewsLoaded && !hasOwnReview && !serviceEligibilityLoading && !canReviewService && !error && (
        <p className="muted-copy">Оставить отзыв можно после оплаты и выполнения услуги.</p>
      )}
      {canSubmitReview && (
        <form className="review-form" onSubmit={submitReview}>
          {type === 'product' && (
            <label>
              Выполненный заказ
              <select
                value={selectedReviewOrderId}
                onChange={(event) => setSelectedOrderId(event.target.value)}
              >
                {reviewOrders.map((order) => (
                  <option key={order.order_id} value={order.order_id}>
                    Заказ №{order.user_order_number || order.order_id}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label>
            Оценка
            <select value={rating} onChange={(event) => setRating(event.target.value)}>
              {[5, 4, 3, 2, 1].map((value) => <option key={value} value={value}>{value} из 5</option>)}
            </select>
          </label>
          <label>
            Комментарий
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              required
              maxLength={1000}
              placeholder="Поделитесь впечатлением"
            />
          </label>
          <button className="button button-outline" type="submit" disabled={saving}>
            {saving ? 'Сохранение…' : 'Оставить отзыв'}
          </button>
        </form>
      )}
      {!user && <p className="muted-copy">Войдите, чтобы оставить отзыв.</p>}
      {!loading && error && (
        <button className="button button-outline" type="button" onClick={reload}>Повторить загрузку</button>
      )}
            </div>
            <div className="modal-actions">
              <button className="button button-outline" type="button" onClick={() => setShowReviews(false)}>
                Закрыть
              </button>
            </div>
          </div>
        </div>,
        document.querySelector('.app-shell') || document.body
      )}
    </>
  );
};
