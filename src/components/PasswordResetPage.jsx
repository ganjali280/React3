import { useState } from 'react';
import { Link } from 'react-router-dom';
import { requestPasswordReset, resetPassword } from '../api/client';

// Управляет запросом кода из письма и сменой пароля.
export const PasswordResetPage = () => {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [codeRequested, setCodeRequested] = useState(false);
  const [complete, setComplete] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Запрашивает код восстановления и показывает результат отправки.
  const sendCode = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    setSubmitting(true);
    try {
      const result = await requestPasswordReset(email.trim());
      setCodeRequested(true);
      setMessage(`${result.message} Код действует 10 минут. Проверьте папку «Спам».`);
    } catch (requestError) {
      setError(requestError.message || 'Не удалось отправить код');
    } finally {
      setSubmitting(false);
    }
  };

  // Проверяет код и сохраняет новый пароль.
  const handleReset = async (event) => {
    event.preventDefault();
    setError('');
    setMessage('');
    if (password !== passwordConfirmation) {
      setError('Пароли не совпадают');
      return;
    }

    setSubmitting(true);
    try {
      const result = await resetPassword(email.trim(), code, password);
      setComplete(true);
      setMessage(result.message);
    } catch (requestError) {
      setError(requestError.message || 'Не удалось восстановить пароль');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="auth-page">
      <div className="auth-card">
        <p className="eyebrow">ВОССТАНОВЛЕНИЕ ДОСТУПА</p>
        <h1>Забыли пароль?</h1>
        {!complete && <p className="auth-intro">Получите код на email и задайте новый пароль.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {message && <p className="success-message" role="status">{message}</p>}

        {complete ? (
          <Link className="button button-primary auth-submit" to="/login">Перейти ко входу</Link>
        ) : !codeRequested ? (
          <form className="auth-form" onSubmit={sendCode}>
            <label htmlFor="reset-email">
              Email аккаунта
              <input
                id="reset-email"
                type="email"
                autoComplete="email"
                maxLength={100}
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <button className="button button-primary auth-submit" type="submit" disabled={submitting}>
              {submitting ? 'Отправка…' : 'Отправить код'}
            </button>
          </form>
        ) : (
          <>
            <form className="auth-form" onSubmit={handleReset}>
              <label htmlFor="reset-code">
                Код из письма
                <input
                  id="reset-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                />
              </label>
              <label htmlFor="reset-password">
                Новый пароль
                <input
                  id="reset-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <label htmlFor="reset-password-confirmation">
                Повторите новый пароль
                <input
                  id="reset-password-confirmation"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  required
                  value={passwordConfirmation}
                  onChange={(event) => setPasswordConfirmation(event.target.value)}
                />
              </label>
              <button className="button button-primary auth-submit" type="submit" disabled={submitting}>
                {submitting ? 'Проверка…' : 'Сменить пароль'}
              </button>
            </form>
            <button
              className="text-button reset-resend"
              type="button"
              onClick={sendCode}
              disabled={submitting}
            >
              Отправить код повторно
            </button>
          </>
        )}
        {!complete && <Link className="auth-back-link" to="/login">Вернуться ко входу</Link>}
      </div>
    </section>
  );
};
