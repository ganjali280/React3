import { useState } from 'react';
import { Link } from 'react-router-dom';
import { containsProhibitedText, isValidFullName, isValidPhone } from '../validation';

// Проверяет форму и отправляет данные для входа или регистрации.
export const AuthPage = ({ mode, onLogin, onRegister }) => {
  const isRegistration = mode === 'register';
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  // Обновляет значение поля и очищает связанную ошибку.
  const updateField = (field, setter) => (event) => {
    setter(event.target.value);
    setFieldErrors((current) => ({ ...current, [field]: '' }));
    setError('');
  };
  // Возвращает сообщение об ошибке для указанного поля.
  const fieldError = (field) => fieldErrors[field] && (
    <span className="field-error" id={`auth-${field}-error`} role="alert">
      {fieldErrors[field]}
    </span>
  );

  // Проверяет форму и выполняет вход либо регистрацию.
  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    const nextFieldErrors = {};
    if (isRegistration && !isValidFullName(name)) {
      nextFieldErrors.name = 'Введите имя и фамилию';
    } else if (isRegistration && containsProhibitedText(name)) {
      nextFieldErrors.name = 'Имя содержит недопустимые слова';
    }
    if (isRegistration && !isValidPhone(phone, { required: true })) {
      nextFieldErrors.phone = 'Введите номер длиной от 10 до 15 цифр';
    }
    if (containsProhibitedText(email)) {
      nextFieldErrors.email = 'Email содержит недопустимые слова';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      nextFieldErrors.email = 'Введите корректный email';
    }
    if (!password) {
      nextFieldErrors.password = 'Введите пароль';
    } else if (password.length < (isRegistration ? 8 : 1) || password.length > 128) {
      nextFieldErrors.password = isRegistration
        ? 'Пароль должен содержать не менее 8 символов'
        : 'Пароль не должен превышать 128 символов';
    }
    if (isRegistration && password !== passwordConfirmation) {
      nextFieldErrors.passwordConfirmation = 'Пароли не совпадают';
    }
    setFieldErrors(nextFieldErrors);
    if (Object.keys(nextFieldErrors).length > 0) {
      return;
    }

    setSubmitting(true);
    try {
      if (isRegistration) {
        await onRegister(name.trim(), email.trim(), password, phone.trim());
      } else {
        await onLogin(email.trim(), password);
      }
    } catch (requestError) {
      const message = requestError.message || 'Не удалось выполнить запрос';
      const normalizedMessage = message.toLocaleLowerCase('ru-RU');
      if (normalizedMessage.includes('email') && !normalizedMessage.includes('пароль')) {
        setFieldErrors({ email: message });
      } else if (normalizedMessage.includes('телефон') || normalizedMessage.includes('номер')) {
        setFieldErrors({ phone: message });
      } else if (normalizedMessage.includes('имя') || normalizedMessage.includes('фио')) {
        setFieldErrors({ name: message });
      } else if (normalizedMessage.includes('пароль')) {
        setFieldErrors({ password: message });
      } else {
        setError(message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="auth-page">
      <div className="auth-card">
        <p className="eyebrow">ЛИЧНЫЙ КАБИНЕТ</p>
        <h1>{isRegistration ? 'Создать аккаунт' : 'Войти в профиль'}</h1>
        <p className="auth-intro">
          {isRegistration
            ? 'Зарегистрируйтесь, чтобы записываться на услуги и оформлять заказы.'
            : 'Введите email и пароль для входа в профиль.'}
        </p>

        {error && <p className="form-error" role="alert">{error}</p>}

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          {isRegistration && (
            <label htmlFor="auth-name">
              ФИО
              <input
                id="auth-name"
                type="text"
                autoComplete="name"
                maxLength={100}
                required
                aria-invalid={Boolean(fieldErrors.name)}
                aria-describedby={fieldErrors.name ? 'auth-name-error' : undefined}
                value={name}
                onChange={updateField('name', setName)}
              />
              {fieldError('name')}
            </label>
          )}
          {isRegistration && (
            <label htmlFor="auth-phone">
              Телефон
              <input
                id="auth-phone"
                type="tel"
                autoComplete="tel"
                maxLength={30}
                inputMode="tel"
                required
                aria-invalid={Boolean(fieldErrors.phone)}
                aria-describedby={fieldErrors.phone ? 'auth-phone-error' : undefined}
                value={phone}
                onChange={updateField('phone', setPhone)}
              />
              {fieldError('phone')}
            </label>
          )}
          <label htmlFor="auth-email">
            Email
            <input
              id="auth-email"
              type="email"
              autoComplete="email"
              maxLength={100}
              required
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? 'auth-email-error' : undefined}
              value={email}
              onChange={updateField('email', setEmail)}
            />
            {fieldError('email')}
          </label>
          <label htmlFor="auth-password">
            Пароль
            <input
              id="auth-password"
              type="password"
              autoComplete={isRegistration ? 'new-password' : 'current-password'}
              minLength={isRegistration ? 8 : undefined}
              maxLength={128}
              required
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={fieldErrors.password ? 'auth-password-error' : undefined}
              value={password}
              onChange={updateField('password', setPassword)}
            />
            {fieldError('password')}
          </label>
          {isRegistration && (
            <label htmlFor="auth-password-confirmation">
              Повторите пароль
              <input
                id="auth-password-confirmation"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                required
                aria-invalid={Boolean(fieldErrors.passwordConfirmation)}
                aria-describedby={fieldErrors.passwordConfirmation ? 'auth-password-confirmation-error' : undefined}
                value={passwordConfirmation}
                onChange={updateField('passwordConfirmation', setPasswordConfirmation)}
              />
              {fieldError('passwordConfirmation')}
            </label>
          )}
          <button className="button button-primary auth-submit" type="submit" disabled={submitting}>
            {submitting ? 'Подождите...' : isRegistration ? 'Зарегистрироваться' : 'Войти'}
          </button>
        </form>

        {!isRegistration && (
          <Link className="auth-back-link" to="/forgot-password">
            Забыли пароль?
          </Link>
        )}
        <p className="auth-switch">
          {isRegistration ? 'Уже есть аккаунт? ' : 'Нет аккаунта? '}
          <Link to={isRegistration ? '/login' : '/register'}>
            {isRegistration ? 'Войти' : 'Зарегистрироваться'}
          </Link>
        </p>
        <Link className="auth-back-link" to="/">Вернуться в каталог</Link>
      </div>
    </section>
  );
};
