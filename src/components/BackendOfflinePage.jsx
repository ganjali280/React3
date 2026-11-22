import { useState } from 'react';

// Показывает сообщение о недоступности сервера и способ повторить подключение.
export const BackendOfflinePage = ({ onRetry, errorMessage }) => {
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  // Повторно проверяет подключение и показывает ошибку при неудаче.
  const retry = async () => {
    setChecking(true);
    setError('');
    try {
      await onRetry();
    } catch (requestError) {
      setError(requestError.message || 'Backend пока недоступен. Попробуйте ещё раз.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <section className="backend-offline-page" role="alert">
      <p className="eyebrow">СОЕДИНЕНИЕ ПОТЕРЯНО</p>
      <h1>Backend выключен</h1>
      <p>{errorMessage || 'Пожалуйста, включите backend-сервер. Когда соединение восстановится, можно продолжить работу.'}</p>
      {error && <p className="form-error">{error}</p>}
      <button className="button button-primary" type="button" onClick={retry} disabled={checking}>
        {checking ? 'Проверяем соединение…' : 'Проверить соединение'}
      </button>
      <p className="muted-copy">Доступ к сайту появится после восстановления backend.</p>
    </section>
  );
};
