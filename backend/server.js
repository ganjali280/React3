const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { Pool } = require("pg");
const nodemailer = require("nodemailer");
const {
  createHash,
  randomBytes,
  randomInt,
  scrypt: scryptCallback,
  timingSafeEqual,
} = require("node:crypto");
const { promisify } = require("node:util");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const scrypt = promisify(scryptCallback);

app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, true);
    const allowedOrigins = new Set([
      process.env.FRONTEND_ORIGIN,
      "http://localhost:5173",
      "http://127.0.0.1:5173",
    ].filter(Boolean));
    if (allowedOrigins.has(origin)) {
      return callback(null, true);
    }
    return callback(Object.assign(new Error("Источник запроса не разрешён"), { status: 403 }));
  },
  credentials: true,
}));
app.use(express.json());

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
});

pool.on("connect", () => {
  console.log("Подключение к PostgreSQL установлено!");
});

pool.on("error", (err) => {
  console.log("Ошибка подключения к PostgreSQL: ", err);
});

// Извлекает токен пользовательской сессии из cookie запроса.
const getSessionToken = (req) => {
  const cookie = req.headers.cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("fec_session="));
  return cookie ? decodeURIComponent(cookie.slice("fec_session=".length)) : null;
};

// Устанавливает защищённую cookie сессии в ответе сервера.
const setSessionCookie = (res, token) => {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `fec_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000${secure}`
  );
};

// Удаляет cookie пользовательской сессии.
const clearSessionCookie = (res) => {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `fec_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`
  );
};

// Создаёт серверную сессию пользователя и отправляет её cookie.
const createSession = async (userId, res) => {
  const token = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await pool.query(
    `INSERT INTO auth_sessions (token_hash, user_id, expires_at)
     VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '30 days')`,
    [tokenHash, userId]
  );
  setSessionCookie(res, token);
};

// Находит активного пользователя по хешу токена сессии.
const getCurrentUser = async (req) => {
  const token = getSessionToken(req);
  if (!token || !/^[a-f0-9]{64}$/i.test(token)) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const result = await pool.query(
    `SELECT u.user_id, u.name, u.email, u.phone, u.default_address,
            u.discount_coupon, u.discount_percent, u.is_active, r.name AS role
     FROM auth_sessions s
     JOIN users u ON u.user_id = s.user_id
     JOIN roles r ON u.role_id = r.role_id
     WHERE s.token_hash = $1 AND s.expires_at > CURRENT_TIMESTAMP`,
    [tokenHash]
  );
  return result.rows[0] || null;
};

// Проверяет сессию пользователя перед выполнением защищённого маршрута.
const requireUser = async (req, res, next) => {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return res.status(401).json({ message: "Сначала войдите в систему" });
    }
    if (!user.is_active) {
      return res.status(403).json({ message: "Аккаунт заблокирован. Обратитесь к администратору." });
    }
    req.user = user;
    next();
  } catch (error) {
    console.error("Ошибка проверки пользователя:", error);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

// Разрешает выполнение маршрута только пользователю с ролью администратора.
const requireAdmin = (req, res, next) =>
  requireUser(req, res, () => {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Недостаточно прав" });
    }
    next();
  });

// Рассчитывает цену позиции каталога с учётом скидки.
const finalPrice = (item) =>
  item.has_discount
    ? Math.round(Number(item.price) * (1 - item.discount_percent / 100))
    : Number(item.price);

// Проверяет данные купона перед сохранением.
const validateCouponPayload = (body) => {
  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
  const percent = Number(body?.percent);
  const usageType = body?.usage_type;
  const isActive = body?.is_active;
  const minOrder = Number(body?.min_order);
  const expiresAt = body?.expires_at ? new Date(body.expires_at) : null;
  if (!/^[A-Z0-9_-]{3,50}$/.test(code)) {
    return { error: "Код купона должен содержать 3–50 латинских букв, цифр, дефисов или подчёркиваний" };
  }
  if (!Number.isInteger(percent) || percent < 1 || percent > 99) {
    return { error: "Скидка купона должна быть целым числом от 1 до 99%" };
  }
  if (!["one_time", "multi_use"].includes(usageType)) {
    return { error: "Выберите одноразовый или многоразовый тип купона" };
  }
  if (typeof isActive !== "boolean") {
    return { error: "Укажите активность купона" };
  }
  if (!Number.isFinite(minOrder) || minOrder < 0 || minOrder > 100000000) {
    return { error: "Минимальная сумма должна быть от 0 до 100 000 000 ₽" };
  }
  if (body?.expires_at && Number.isNaN(expiresAt.getTime())) {
    return { error: "Укажите корректный срок действия купона" };
  }
  return {
    value: {
      code,
      percent,
      usageType,
      isActive,
      minOrder,
      expiresAt,
    },
  };
};

// Создаёт хеш пароля с уникальной солью.
const hashPassword = async (password) => {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${derivedKey.toString("hex")}`;
};

// Сверяет пароль с сохранённым хешем.
const verifyPassword = async (password, storedPassword) => {
  if (!storedPassword.startsWith("scrypt$")) {
    return storedPassword === password;
  }

  const [, salt, storedKey] = storedPassword.split("$");
  if (!salt || !storedKey || !/^[a-f0-9]{128}$/i.test(storedKey)) {
    return false;
  }

  const expected = Buffer.from(storedKey, "hex");
  const actual = await scrypt(password, salt, expected.length);
  return timingSafeEqual(actual, expected);
};

const profanityCharacterMap = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
  з: "z", и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "x", ц: "ts",
  ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu",
  я: "ya", 0: "o", 1: "i", 2: "z", 3: "e", 4: "a", 5: "s", 6: "g",
  7: "t", 8: "b", 9: "g", "!": "i", "@": "a", $: "s",
};

const latinKeyboardToRussian = {
  q: "й", w: "ц", e: "у", r: "к", t: "е", y: "н", u: "г", i: "ш", o: "щ",
  p: "з", a: "ф", s: "ы", d: "в", f: "а", g: "п", h: "р", j: "о", k: "л",
  l: "д", z: "я", x: "ч", c: "с", v: "м", b: "и", n: "т", m: "ь",
};

// Нормализует текст для поиска запрещённых слов в разных написаниях.
const normalizeProhibitedCandidate = (value) =>
  String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\p{M}/gu, "")
    .replace(/[\u200B-\u200F\uFEFF]/g, "")
    .replace(/[а-яё0-9!@$]/gu, (character) => profanityCharacterMap[character] ?? character)
    .split(/[^a-z]+/u)
    .filter(Boolean)
    .map((word) => word.replace(/(.)\1+/g, "$1"));

// Проверяет, что ФИО состоит как минимум из двух корректных частей.
const isValidFullName = (value) => {
  const parts = String(value || "").normalize("NFKC").trim().split(/\s+/u);
  return parts.length >= 2 && parts.every((part) =>
    /^\p{L}{2,}(?:[-'’]\p{L}{2,})*$/u.test(part)
  );
};

// Оставляет в телефонном номере только цифры.
const getPhoneDigits = (value) => String(value || "").replace(/\D/g, "");

// Проверяет формат и количество цифр в телефонном номере.
const isValidPhone = (value) => {
  const phone = String(value || "").trim();
  if (!/^\+?\d[\d\s()-]*\d$/.test(phone) || /\(\s*\)/.test(phone)) return false;
  const digits = getPhoneDigits(phone);
  if (digits.length < 10 || digits.length > 15) return false;

  let depth = 0;
  for (const character of phone) {
    if (character === "(") {
      if (depth !== 0) return false;
      depth = 1;
    } else if (character === ")") {
      if (depth === 0) return false;
      depth = 0;
    }
  }
  return depth === 0;
};

const prohibitedWords = [
  "blya", "blyad", "blyat", "suka", "cyka", "cuka", "pizd", "hui", "huy",
  "xui", "xuy", "huya", "huye", "hue", "xue", "mudak", "gandon", "ebat",
  "yob", "pidor", "daun", "govno", "dermo", "mraz", "sran", "zalup", "chmo",
  "her", "xer", "fuck", "shit", "bitch", "asshole", "bastard", "cunt", "dick",
  "cock", "slut", "whore", "fag",
];

// Проверяет, отличается ли слово от запрещённого ровно одним символом.
const containsNearProhibitedWord = (word, prohibitedWord) => {
  if (word.length !== prohibitedWord.length) return false;
  let differences = 0;
  for (let index = 0; index < prohibitedWord.length; index += 1) {
    if (word[index] !== prohibitedWord[index]) {
      differences += 1;
      if (differences > 1) break;
    }
  }
  return differences === 1;
};

// Ищет запрещённые слова в нормализованном тексте.
const hasProhibitedCandidate = (candidate) => {
  const words = normalizeProhibitedCandidate(candidate);
  const compact = words.join("");
  if (prohibitedWords.some((word) => compact.includes(word))) return true;
  return words.some((word) =>
    prohibitedWords.some((prohibitedWord) => containsNearProhibitedWord(word, prohibitedWord))
  );
};

// Проверяет текст с учётом подмены символов и раскладки клавиатуры.
const hasProhibitedText = (value) => {
  const text = String(value || "");
  const keyboardVariant = text.replace(/[a-z]/gi, (character) =>
    latinKeyboardToRussian[character.toLowerCase()] || character
  );
  return hasProhibitedCandidate(text) || hasProhibitedCandidate(keyboardVariant);
};

const ignoredProhibitedTextFields = new Set([
  "password",
  "current_password",
  "new_password",
  "password_confirmation",
  "phone",
  "delivery_date",
  "appointment_date",
  "appointment_time",
  "expires_at",
  "type",
  "status",
  "payment_method",
]);

// Проверяет текстовые поля запроса, пропуская поля с не-текстовым содержимым.
const hasProhibitedRequestText = (value, path, fieldName = "") => {
  if (typeof value === "string") {
    const normalizedFieldName = fieldName.toLowerCase();
    if (
      ignoredProhibitedTextFields.has(normalizedFieldName) ||
      (path === "/api/auth/reset-password" && normalizedFieldName === "code")
    ) {
      return false;
    }
    return hasProhibitedText(value);
  }
  if (Array.isArray(value)) {
    return value.some((entry) => hasProhibitedRequestText(entry, path, fieldName));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).some(([key, entry]) =>
      hasProhibitedRequestText(entry, path, key)
    );
  }
  return false;
};

app.use((req, res, next) => {
  if (
    ["POST", "PUT", "PATCH"].includes(req.method) &&
    hasProhibitedRequestText(req.body, req.path)
  ) {
    return res.status(400).json({ message: "Текстовое поле содержит недопустимые слова" });
  }
  next();
});

const smtpPassword = process.env.SMTP_PASS || process.env.SMTP_PASSWORD;
const smtpFrom = process.env.SMTP_FROM?.replace(/^<|>$/g, "");
const smtpReady = Boolean(
  process.env.SMTP_HOST &&
  smtpFrom &&
  process.env.SMTP_USER &&
  smtpPassword
);
const mailTransport = smtpReady
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: smtpPassword,
      },
    })
  : null;

const RESET_REQUEST_MESSAGE =
  "Если аккаунт с таким email существует, на него отправлен код восстановления.";

// Запрашивает код восстановления пароля и отправляет его на электронную почту.
app.post("/api/auth/forgot-password", async (req, res) => {
  const email =
    typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 100) {
    return res.status(400).json({ message: "Укажите корректный email" });
  }
  if (!mailTransport) {
    return res.status(503).json({
      message: "Отправка почты не настроена. Администратору нужно задать параметры SMTP.",
    });
  }

  try {
    const userResult = await pool.query(
      "SELECT user_id FROM users WHERE LOWER(email) = $1",
      [email]
    );
    if (userResult.rows.length === 0) {
      return res.json({ message: RESET_REQUEST_MESSAGE });
    }

    const userId = userResult.rows[0].user_id;
    const recentRequest = await pool.query(
      `SELECT 1 FROM password_reset_codes
       WHERE user_id = $1 AND created_at > CURRENT_TIMESTAMP - INTERVAL '1 minute'`,
      [userId]
    );
    if (recentRequest.rows.length > 0) {
      return res.json({ message: RESET_REQUEST_MESSAGE });
    }

    const code = String(randomInt(100000, 1000000));
    const codeHash = await hashPassword(code);
    await pool.query(
      `INSERT INTO password_reset_codes (user_id, code_hash, expires_at, attempts, created_at)
       VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '10 minutes', 0, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id)
       DO UPDATE SET code_hash = EXCLUDED.code_hash,
                     expires_at = EXCLUDED.expires_at,
                     attempts = 0,
                     created_at = CURRENT_TIMESTAMP`,
      [userId, codeHash]
    );

    try {
      await mailTransport.sendMail({
        from: smtpFrom,
        to: email,
        subject: "Восстановление пароля",
        text: `Код для восстановления пароля: ${code}\nКод действует 10 минут. Если вы не запрашивали восстановление, проигнорируйте это письмо.`,
      });
    } catch (mailError) {
      await pool.query("DELETE FROM password_reset_codes WHERE user_id = $1", [userId]);
      console.error("Не удалось отправить письмо для восстановления пароля:", mailError);
      return res.status(503).json({
        message: "Не удалось отправить письмо. Проверьте настройки SMTP или попробуйте позже.",
      });
    }

    res.json({ message: RESET_REQUEST_MESSAGE });
  } catch (error) {
    console.error("Ошибка запроса восстановления пароля:", error);
    res.status(500).json({ message: "Не удалось создать запрос восстановления пароля" });
  }
});

// Проверяет код восстановления и сохраняет новый пароль.
app.post("/api/auth/reset-password", async (req, res) => {
  const email =
    typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
  const code = typeof req.body?.code === "string" ? req.body.code.trim() : "";
  const newPassword = req.body?.new_password;
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 100 ||
    !/^\d{6}$/.test(code) ||
    typeof newPassword !== "string" ||
    newPassword.length < 8 ||
    newPassword.length > 128
  ) {
    return res.status(400).json({
      message: "Проверьте email, шестизначный код и пароль (8–128 символов)",
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `SELECT c.user_id, c.code_hash, c.expires_at, c.attempts, u.password
       FROM password_reset_codes c
       JOIN users u ON u.user_id = c.user_id
       WHERE LOWER(u.email) = $1
       FOR UPDATE OF c`,
      [email]
    );
    const reset = result.rows[0];
    if (!reset) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Код неверный или срок его действия истёк" });
    }
    if (Number(reset.attempts) >= 5 || new Date(reset.expires_at) <= new Date()) {
      await client.query("DELETE FROM password_reset_codes WHERE user_id = $1", [reset.user_id]);
      await client.query("COMMIT");
      return res.status(400).json({ message: "Код неверный или срок его действия истёк" });
    }
    if (!(await verifyPassword(code, reset.code_hash))) {
      if (Number(reset.attempts) >= 4) {
        await client.query("DELETE FROM password_reset_codes WHERE user_id = $1", [reset.user_id]);
      } else {
        await client.query(
          "UPDATE password_reset_codes SET attempts = attempts + 1 WHERE user_id = $1",
          [reset.user_id]
        );
      }
      await client.query("COMMIT");
      return res.status(400).json({ message: "Код неверный или срок его действия истёк" });
    }
    if (await verifyPassword(newPassword, reset.password)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ message: "Новый пароль должен отличаться от старого" });
    }

    const passwordHash = await hashPassword(newPassword);
    await client.query("UPDATE users SET password = $1 WHERE user_id = $2", [
      passwordHash,
      reset.user_id,
    ]);
    await client.query("DELETE FROM auth_sessions WHERE user_id = $1", [reset.user_id]);
    await client.query("DELETE FROM password_reset_codes WHERE user_id = $1", [reset.user_id]);
    await client.query("COMMIT");
    res.json({ message: "Пароль изменён. Теперь войдите с новым паролем." });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Ошибка восстановления пароля:", error);
    res.status(500).json({ message: "Не удалось восстановить пароль. Попробуйте позже." });
  } finally {
    client.release();
  }
});

// Обновляет контактные данные пользователя и его пароль.
app.patch("/api/profile", requireUser, async (req, res) => {
  const { name, email, phone, default_address, current_password, new_password } = req.body || {};
  const normalizedName = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  const normalizedPhone = typeof phone === "string" ? phone.trim() : "";
  const normalizedAddress = typeof default_address === "string" ? default_address.trim() : "";

  if (
    hasProhibitedText(normalizedName) ||
    hasProhibitedText(normalizedAddress)
  ) {
    return res.status(400).json({ message: "Текст содержит недопустимые слова" });
  }

  if (
    !isValidFullName(normalizedName) ||
    normalizedName.length > 100 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
    normalizedEmail.length > 100 ||
    (phone != null && typeof phone !== "string") ||
    (normalizedPhone && !isValidPhone(normalizedPhone)) ||
    normalizedAddress.length > 500
  ) {
    return res.status(400).json({
      message: "Введите имя и фамилию, корректный email и телефон (если указан)",
    });
  }
  if (new_password && (typeof new_password !== "string" || new_password.length < 8 || new_password.length > 128)) {
    return res.status(400).json({ message: "Новый пароль должен содержать от 8 до 128 символов" });
  }

  try {
    if (normalizedPhone) {
      const duplicatePhone = await pool.query(
        `SELECT 1 FROM users
         WHERE user_id <> $1
           AND regexp_replace(phone, '[^0-9]', '', 'g') = $2
         LIMIT 1`,
        [req.user.user_id, getPhoneDigits(normalizedPhone)]
      );
      if (duplicatePhone.rows.length > 0) {
        return res.status(409).json({ message: "Этот номер телефона уже используется", field: "phone" });
      }
    }

    let passwordHash;
    if (new_password) {
      if (typeof current_password !== "string" || !current_password) {
        return res.status(400).json({ message: "Для смены пароля укажите текущий пароль" });
      }
      const current = await pool.query("SELECT password FROM users WHERE user_id = $1", [req.user.user_id]);
      if (!current.rows[0] || !(await verifyPassword(current_password, current.rows[0].password))) {
        return res.status(400).json({ message: "Текущий пароль указан неверно" });
      }
      if (await verifyPassword(new_password, current.rows[0].password)) {
        return res.status(400).json({ message: "Новый пароль должен отличаться от старого" });
      }
      passwordHash = await hashPassword(new_password);
    }

    const result = await pool.query(
      `UPDATE users
       SET name = $1, email = $2, phone = $3, default_address = $4,
           password = COALESCE($5, password)
       WHERE user_id = $6
       RETURNING user_id, name, email, phone, default_address, discount_coupon, discount_percent`,
      [
        normalizedName,
        normalizedEmail,
        normalizedPhone || null,
        normalizedAddress || null,
        passwordHash || null,
        req.user.user_id,
      ]
    );
    res.json({ ...result.rows[0], role: req.user.role });
  } catch (error) {
    if (error.code === "23505") {
      if (error.constraint === "users_phone_digits_unique") {
        return res.status(409).json({ message: "Этот номер телефона уже используется", field: "phone" });
      }
      return res.status(409).json({ message: "Пользователь с таким email уже существует" });
    }
    console.error("Ошибка обновления профиля:", error);
    res.status(500).json({ message: "Ошибка сервера при сохранении профиля" });
  }
});

// Проверяет доступность серверного приложения.
app.get("/api/test", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ message: "API и база данных работают", timestamp: new Date() });
  } catch (error) {
    console.error("Ошибка проверки доступности backend:", error);
    res.status(503).json({
      message: "Backend запущен, но база данных недоступна. Проверьте подключение PostgreSQL.",
    });
  }
});

// Проверяет доступность подключения к базе данных.
app.get("/api/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS current_time");
    res.json({
      message: "Подключение к БД работает!",
      current_time: result.rows[0].current_time,
    });
  } catch (error) {
    console.error("Ошибка теста БД: ", error);
    res.status(500).json({ message: "База данных недоступна. Проверьте подключение PostgreSQL." });
  }
});

// Возвращает список доступных услуг каталога.
app.get("/api/services", async (req, res) => {
  try {
    const query = `
      SELECT s.service_id, s.category_id, s.name, s.description, s.duration,
             s.price::float8 AS price, s.has_discount, s.discount_percent,
             s.image_url, c.name AS category_name
      FROM services s
      JOIN categories c ON s.category_id = c.category_id
      ORDER BY s.service_id ASC
    `;
    const result = await pool.query(query);
    console.log(`Найдено услуг: ${result.rows.length}`);
    res.json(result.rows);
  } catch (error) {
    console.error("Ошибка запроса services:", error);
    res.status(500).json({ error: error.message });
  }
});

// Возвращает отзывы о выбранной услуге.
app.get("/api/services/:id/reviews", async (req, res) => {
  const serviceId = Number(req.params.id);
  if (!Number.isInteger(serviceId) || serviceId < 1) {
    return res.status(400).json({ message: "Некорректный идентификатор услуги" });
  }
  try {
    const currentUser = await getCurrentUser(req);
    const result = await pool.query(
      `SELECT rv.review_id, rv.rating, rv.comment, rv.is_removed, rv.created_at, u.name AS user_name,
              (rv.user_id = $2) AS is_own
       FROM service_reviews rv
       JOIN users u ON u.user_id = rv.user_id
       JOIN services s ON s.service_id = rv.service_id
       WHERE rv.service_id = $1
         AND EXISTS (
           SELECT 1
           FROM appointments a
           JOIN payments pay ON pay.appointment_id = a.appointment_id
           WHERE a.user_id = rv.user_id
             AND a.service_id = rv.service_id
             AND a.status = 'completed'
             AND pay.status = 'completed'
         )
       ORDER BY rv.created_at DESC, rv.review_id DESC`,
      [serviceId, currentUser?.user_id ?? null]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Ошибка загрузки отзывов:", error);
    res.status(500).json({ message: "Ошибка сервера при загрузке отзывов" });
  }
});

// Проверяет, может ли пользователь оставить отзыв об услуге.
app.get("/api/services/:id/review-eligibility", requireUser, async (req, res) => {
  const serviceId = Number(req.params.id);
  if (!Number.isInteger(serviceId) || serviceId < 1) {
    return res.status(400).json({ message: "Некорректный идентификатор услуги" });
  }
  if (req.user.role !== "client") {
    return res.status(403).json({ message: "Отзывы могут оставлять только клиенты" });
  }
  try {
    const result = await pool.query(
      `SELECT EXISTS (
         SELECT 1
         FROM appointments a
         JOIN payments pay ON pay.appointment_id = a.appointment_id
         WHERE a.user_id = $1
           AND a.service_id = $2
           AND a.status = 'completed'
           AND pay.status = 'completed'
       )
       AND NOT EXISTS (
         SELECT 1 FROM service_reviews rv
         WHERE rv.user_id = $1 AND rv.service_id = $2
       ) AS can_review
       FROM services
       WHERE service_id = $2`,
      [req.user.user_id, serviceId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Услуга не найдена" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Ошибка проверки покупки услуги:", error);
    res.status(500).json({ message: "Ошибка сервера при проверке покупки услуги" });
  }
});

// Возвращает отзывы о выбранном товаре.
app.get("/api/products/:id/reviews", async (req, res) => {
  const productId = Number(req.params.id);
  if (!Number.isInteger(productId) || productId < 1) {
    return res.status(400).json({ message: "Некорректный идентификатор товара" });
  }
  try {
    const currentUser = await getCurrentUser(req);
    const result = await pool.query(
      `SELECT rv.review_id, rv.order_id, rv.rating, rv.comment, rv.is_removed, rv.created_at,
              u.name AS user_name, (rv.user_id = $2) AS is_own
       FROM product_reviews rv
       JOIN users u ON u.user_id = rv.user_id
       JOIN products p ON p.product_id = rv.product_id
       JOIN orders o ON o.order_id = rv.order_id
       JOIN payments pay ON pay.order_id = o.order_id
       JOIN order_items oi
         ON oi.order_id = o.order_id AND oi.product_id = rv.product_id
       WHERE rv.product_id = $1
         AND o.status = 'completed'
         AND pay.status = 'completed'
       ORDER BY rv.created_at DESC, rv.review_id DESC`,
      [productId, currentUser?.user_id ?? null]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Ошибка загрузки отзывов товара:", error);
    res.status(500).json({ message: "Ошибка сервера при загрузке отзывов" });
  }
});

// Возвращает заказы пользователя, необходимые для проверки отзыва о товаре.
app.get("/api/products/:id/review-orders", requireUser, async (req, res) => {
  const productId = Number(req.params.id);
  if (!Number.isInteger(productId) || productId < 1) {
    return res.status(400).json({ message: "Некорректный идентификатор товара" });
  }
  if (req.user.role !== "client") {
    return res.status(403).json({ message: "Отзывы могут оставлять только клиенты" });
  }
  try {
    const result = await pool.query(
      `SELECT o.order_id, o.user_order_number, o.created_at
       FROM orders o
       JOIN order_items oi ON oi.order_id = o.order_id
       JOIN payments pay ON pay.order_id = o.order_id
       WHERE o.user_id = $1
         AND o.status = 'completed'
         AND pay.status = 'completed'
         AND oi.product_id = $2
         AND NOT EXISTS (
           SELECT 1
           FROM product_reviews rv
           WHERE rv.user_id = $1 AND rv.product_id = $2
         )
       ORDER BY o.created_at DESC, o.order_id DESC`,
      [req.user.user_id, productId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Ошибка загрузки заказов для отзыва товара:", error);
    res.status(500).json({ message: "Ошибка сервера при проверке покупки товара" });
  }
});

// Создаёт отзыв пользователя об услуге.
app.post("/api/services/:id/reviews", requireUser, async (req, res) => {
  const serviceId = Number(req.params.id);
  const rating = Number(req.body?.rating);
  const comment = typeof req.body?.comment === "string" ? req.body.comment.trim() : "";
  if (hasProhibitedText(comment)) {
    return res.status(400).json({ message: "Отзыв содержит недопустимые слова" });
  }
  if (
    req.user.role !== "client" ||
    !Number.isInteger(serviceId) ||
    serviceId < 1 ||
    !Number.isInteger(rating) ||
    rating < 1 ||
    rating > 5 ||
    !comment ||
    comment.length > 1000
  ) {
    return res.status(400).json({ message: "Укажите оценку от 1 до 5 и комментарий от 1 до 1000 символов" });
  }
  try {
    const purchase = await pool.query(
      `SELECT EXISTS (
         SELECT 1
         FROM appointments a
         JOIN payments pay ON pay.appointment_id = a.appointment_id
         WHERE a.user_id = $1
           AND a.service_id = $2
           AND a.status = 'completed'
           AND pay.status = 'completed'
       ) AS has_purchase,
       EXISTS (
         SELECT 1 FROM service_reviews rv
         WHERE rv.user_id = $1 AND rv.service_id = $2
       ) AS already_reviewed
       FROM services
       WHERE service_id = $2`,
      [req.user.user_id, serviceId]
    );
    if (purchase.rows.length === 0) {
      return res.status(404).json({ message: "Услуга не найдена" });
    }
    if (!purchase.rows[0].has_purchase) {
      return res.status(403).json({ message: "Оставить отзыв можно только после оплаты и выполнения услуги" });
    }
    if (purchase.rows[0].already_reviewed) {
      return res.status(409).json({ message: "Вы уже оставили отзыв на эту услугу" });
    }

    const result = await pool.query(
      `INSERT INTO service_reviews (user_id, service_id, rating, comment)
       VALUES ($1, $2, $3, $4)
       RETURNING review_id, rating, comment, created_at`,
      [req.user.user_id, serviceId, rating, comment || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23503") {
      return res.status(404).json({ message: "Услуга не найдена" });
    }
    if (error.code === "23505") {
      return res.status(409).json({ message: "Вы уже оставили отзыв на эту услугу" });
    }
    console.error("Ошибка сохранения отзыва:", error);
    res.status(500).json({ message: "Ошибка сервера при сохранении отзыва" });
  }
});

// Создаёт отзыв пользователя о купленном товаре.
app.post("/api/products/:id/reviews", requireUser, async (req, res) => {
  const productId = Number(req.params.id);
  const orderId = Number(req.body?.order_id);
  const rating = Number(req.body?.rating);
  const comment = typeof req.body?.comment === "string" ? req.body.comment.trim() : "";
  if (hasProhibitedText(comment)) {
    return res.status(400).json({ message: "Отзыв содержит недопустимые слова" });
  }
  if (
    req.user.role !== "client" ||
    !Number.isInteger(productId) ||
    productId < 1 ||
    !Number.isInteger(orderId) ||
    orderId < 1 ||
    !Number.isInteger(rating) ||
    rating < 1 ||
    rating > 5 ||
    !comment ||
    comment.length > 1000
  ) {
    return res.status(400).json({ message: "Укажите завершённый заказ, оценку от 1 до 5 и комментарий от 1 до 1000 символов" });
  }
  try {
    const purchase = await pool.query(
      `SELECT EXISTS (
         SELECT 1
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.order_id
         JOIN payments pay ON pay.order_id = o.order_id
         WHERE o.order_id = $1
           AND o.user_id = $2
           AND o.status = 'completed'
           AND pay.status = 'completed'
           AND oi.product_id = $3
       ) AS has_purchase,
       EXISTS (
         SELECT 1 FROM product_reviews rv
         WHERE rv.user_id = $2 AND rv.product_id = $3
       ) AS already_reviewed
       FROM products
       WHERE product_id = $3`,
      [orderId, req.user.user_id, productId]
    );
    if (purchase.rows.length === 0) {
      return res.status(404).json({ message: "Товар не найден" });
    }
    if (!purchase.rows[0].has_purchase) {
      return res.status(403).json({ message: "Оставить отзыв можно только на оплаченный товар из выполненного заказа" });
    }
    if (purchase.rows[0].already_reviewed) {
      return res.status(409).json({ message: "Вы уже оставили отзыв на этот товар" });
    }

    const result = await pool.query(
      `INSERT INTO product_reviews (user_id, product_id, order_id, rating, comment)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING review_id, order_id, rating, comment, created_at`,
      [req.user.user_id, productId, orderId, rating, comment || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === "23503") {
      return res.status(404).json({ message: "Товар не найден" });
    }
    if (error.code === "23505") {
      return res.status(409).json({ message: "Вы уже оставили отзыв на этот товар" });
    }
    console.error("Ошибка сохранения отзыва товара:", error);
    res.status(500).json({ message: "Ошибка сервера при сохранении отзыва" });
  }
});

// Обновляет собственный отзыв пользователя.
app.patch("/api/reviews/:type/:id", requireUser, async (req, res) => {
  const { type } = req.params;
  const reviewId = Number(req.params.id);
  const table = type === "product"
    ? "product_reviews"
    : type === "service"
      ? "service_reviews"
      : null;
  const rating = Number(req.body?.rating);
  const comment = typeof req.body?.comment === "string" ? req.body.comment.trim() : "";
  if (req.user.role !== "client") {
    return res.status(403).json({ message: "Изменять отзывы могут только клиенты" });
  }
  if (!table || !Number.isInteger(reviewId) || reviewId < 1) {
    return res.status(400).json({ message: "Укажите корректный отзыв" });
  }
  if (hasProhibitedText(comment)) {
    return res.status(400).json({ message: "Отзыв содержит недопустимые слова" });
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5 || !comment || comment.length > 1000) {
    return res.status(400).json({ message: "Укажите оценку от 1 до 5 и комментарий от 1 до 1000 символов" });
  }
  try {
    const result = await pool.query(
      `UPDATE ${table}
       SET rating = $1, comment = $2
       WHERE review_id = $3 AND user_id = $4 AND is_removed = FALSE
       RETURNING review_id, rating, comment, created_at`,
      [rating, comment, reviewId, req.user.user_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Отзыв не найден или нет прав на изменение" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Ошибка изменения отзыва клиента:", error);
    res.status(500).json({ message: "Ошибка сервера при изменении отзыва" });
  }
});

// Удаляет собственный отзыв пользователя.
app.delete("/api/reviews/:type/:id", requireUser, async (req, res) => {
  const { type } = req.params;
  const reviewId = Number(req.params.id);
  const table = type === "product"
    ? "product_reviews"
    : type === "service"
      ? "service_reviews"
      : null;
  if (req.user.role !== "client") {
    return res.status(403).json({ message: "Удалять отзывы могут только клиенты" });
  }
  if (!table || !Number.isInteger(reviewId) || reviewId < 1) {
    return res.status(400).json({ message: "Укажите корректный отзыв" });
  }
  try {
    const result = await pool.query(
      `DELETE FROM ${table}
       WHERE review_id = $1 AND user_id = $2 AND is_removed = FALSE
       RETURNING review_id`,
      [reviewId, req.user.user_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Отзыв не найден или нет прав на удаление" });
    }
    res.json({ message: "Отзыв удалён" });
  } catch (error) {
    console.error("Ошибка удаления отзыва клиента:", error);
    res.status(500).json({ message: "Ошибка сервера при удалении отзыва" });
  }
});

// Возвращает администратору отзывы для проверки и модерации.
app.get("/api/admin/reviews", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT rv.review_id, rv.rating, rv.comment, rv.is_removed, rv.created_at,
              'service'::text AS item_type, s.name AS item_name,
              u.name AS user_name, u.email AS user_email
       FROM service_reviews rv
       JOIN services s ON s.service_id = rv.service_id
       JOIN users u ON u.user_id = rv.user_id
       UNION ALL
       SELECT rv.review_id, rv.rating, rv.comment, rv.is_removed, rv.created_at,
              'product'::text AS item_type, p.name AS item_name,
              u.name AS user_name, u.email AS user_email
       FROM product_reviews rv
       JOIN products p ON p.product_id = rv.product_id
       JOIN users u ON u.user_id = rv.user_id
       ORDER BY created_at DESC, review_id DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Ошибка загрузки отзывов для админ-панели:", error);
    res.status(500).json({ message: "Ошибка сервера при загрузке отзывов" });
  }
});

// Удаляет отзыв по идентификатору из административной панели.
app.delete("/api/admin/reviews/:id", requireAdmin, async (req, res) => {
  const reviewId = Number(req.params.id);
  if (!Number.isInteger(reviewId) || reviewId < 1) {
    return res.status(400).json({ message: "Некорректный отзыв" });
  }
  try {
    const result = await pool.query(
      `UPDATE service_reviews
       SET is_removed = TRUE, comment = NULL
       WHERE review_id = $1 AND is_removed = FALSE
       RETURNING review_id`,
      [reviewId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Отзыв не найден" });
    }
    res.json({ message: "Отзыв удалён за нарушение политики" });
  } catch (error) {
    console.error("Ошибка удаления отзыва:", error);
    res.status(500).json({ message: "Ошибка сервера при удалении отзыва" });
  }
});

// Удаляет отзыв указанного типа из административной панели.
app.delete("/api/admin/reviews/:type/:id", requireAdmin, async (req, res) => {
  const { type } = req.params;
  const reviewId = Number(req.params.id);
  const table = type === "product"
    ? "product_reviews"
    : type === "service"
      ? "service_reviews"
      : null;
  if (!table || !Number.isInteger(reviewId) || reviewId < 1) {
    return res.status(400).json({ message: "Укажите корректный отзыв" });
  }
  try {
    const result = await pool.query(
      `UPDATE ${table}
       SET is_removed = TRUE, comment = NULL
       WHERE review_id = $1 AND is_removed = FALSE
       RETURNING review_id`,
      [reviewId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Отзыв не найден" });
    }
    res.json({ message: "Отзыв удалён за нарушение политики" });
  } catch (error) {
    console.error("Ошибка удаления отзыва:", error);
    res.status(500).json({ message: "Ошибка сервера при удалении отзыва" });
  }
});

// Возвращает администратору список заказов клиентов.
app.get("/api/admin/orders", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.order_id, o.user_order_number, o.status, o.total::float8 AS total, o.created_at,
              o.delivery_address, o.delivery_date::text AS delivery_date,
              o.coupon_code, o.coupon_percent,
              o.coupon_discount_amount::float8 AS coupon_discount_amount,
              pay.status AS payment_status, pay.payment_method,
              COALESCE(
                json_agg(
                  json_build_object(
                    'product_id', oi.product_id,
                    'name', p.name,
                    'quantity', oi.quantity,
                    'unit_price', oi.unit_price::float8,
                    'image_url', p.image_url
                  )
                ) FILTER (WHERE oi.item_id IS NOT NULL),
                '[]'::json
              ) AS items,
              u.name AS customer_name, u.email AS customer_email
       FROM orders o
       JOIN users u ON u.user_id = o.user_id
       LEFT JOIN order_items oi ON oi.order_id = o.order_id
       LEFT JOIN products p ON p.product_id = oi.product_id
       LEFT JOIN payments pay ON pay.order_id = o.order_id
       GROUP BY o.order_id, o.user_order_number, o.status, o.total, o.created_at,
                o.delivery_address, o.delivery_date, o.coupon_code,
                o.coupon_percent, o.coupon_discount_amount, pay.status,
                pay.payment_method, u.name, u.email
       ORDER BY o.order_id DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Ошибка загрузки заказов для админ-панели:", error);
    res.status(500).json({ message: "Ошибка сервера при загрузке заказов" });
  }
});

// Обновляет статус заказа клиента.
app.patch("/api/admin/orders/:id/status", requireAdmin, async (req, res) => {
  const orderId = Number(req.params.id);
  const status = req.body?.status;
  if (!Number.isInteger(orderId) || orderId < 1 || !["new", "scheduled", "completed"].includes(status)) {
    return res.status(400).json({ message: "Укажите корректный заказ и статус" });
  }
  try {
    const result = await pool.query(
      "UPDATE orders SET status = $1 WHERE order_id = $2 RETURNING order_id, status",
      [status, orderId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Заказ не найден" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Ошибка изменения статуса заказа:", error);
    res.status(500).json({ message: "Ошибка сервера при изменении заказа" });
  }
});

// Подтверждает получение оплаты за заказ клиента.
app.patch("/api/admin/orders/:id/payment", requireAdmin, async (req, res) => {
  const orderId = Number(req.params.id);
  if (!Number.isInteger(orderId) || orderId < 1) {
    return res.status(400).json({ message: "Укажите корректный заказ" });
  }
  try {
    const order = await pool.query(
      `SELECT o.status AS order_status, p.status AS payment_status, p.payment_method
       FROM orders o
       LEFT JOIN payments p ON p.order_id = o.order_id
       WHERE o.order_id = $1
       LIMIT 1`,
      [orderId]
    );
    if (order.rows.length === 0) {
      return res.status(404).json({ message: "Заказ не найден" });
    }
    if (order.rows[0].order_status !== "completed") {
      return res.status(409).json({ message: "Сначала отметьте заказ выполненным" });
    }
    if (order.rows[0].payment_status === null) {
      return res.status(404).json({ message: "Для заказа не найден платёж" });
    }
    if (order.rows[0].payment_method !== "at_delivery") {
      return res.status(409).json({ message: "Этот способ оплаты нельзя отметить вручную" });
    }
    if (order.rows[0].payment_status !== "pending") {
      return res.status(409).json({ message: "Платёж уже обработан" });
    }

    const result = await pool.query(
      `UPDATE payments p
       SET status = 'completed'
       FROM orders o
       WHERE p.order_id = o.order_id
         AND o.order_id = $1
         AND o.status = 'completed'
         AND p.status = 'pending'
         AND p.payment_method = 'at_delivery'
       RETURNING p.status AS payment_status`,
      [orderId]
    );
    if (result.rows.length === 0) {
      return res.status(409).json({ message: "Статус платежа изменился. Обновите список заказов" });
    }
    res.json({ order_id: orderId, payment_status: result.rows[0].payment_status });
  } catch (error) {
    console.error("Ошибка подтверждения оплаты заказа:", error);
    res.status(500).json({ message: "Ошибка сервера при подтверждении оплаты" });
  }
});

// Возвращает администратору записи клиентов на услуги.
app.get("/api/admin/appointments", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.appointment_id, a.status, a.quantity,
              a.order_id, o.user_order_number,
              a.appointment_date::text AS appointment_date,
              to_char(a.appointment_time, 'HH24:MI') AS appointment_time,
              pay.status AS payment_status, pay.payment_method,
              s.name AS service_name, u.name AS customer_name, u.email AS customer_email
       FROM appointments a
       LEFT JOIN orders o ON o.order_id = a.order_id
       LEFT JOIN payments pay ON pay.appointment_id = a.appointment_id
       JOIN services s ON s.service_id = a.service_id
       JOIN users u ON u.user_id = a.user_id
       ORDER BY a.appointment_id DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Ошибка загрузки записей для админ-панели:", error);
    res.status(500).json({ message: "Ошибка сервера при загрузке записей" });
  }
});

// Обновляет статус записи клиента на услугу.
app.patch("/api/admin/appointments/:id/status", requireAdmin, async (req, res) => {
  const appointmentId = Number(req.params.id);
  const status = req.body?.status;
  if (!Number.isInteger(appointmentId) || appointmentId < 1 || !["scheduled", "completed"].includes(status)) {
    return res.status(400).json({ message: "Укажите корректную запись и статус" });
  }
  try {
    const result = await pool.query(
      "UPDATE appointments SET status = $1 WHERE appointment_id = $2 RETURNING appointment_id, status",
      [status, appointmentId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Запись не найдена" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Ошибка изменения статуса записи:", error);
    res.status(500).json({ message: "Ошибка сервера при изменении записи" });
  }
});

// Подтверждает получение оплаты за услугу.
app.patch("/api/admin/appointments/:id/payment", requireAdmin, async (req, res) => {
  const appointmentId = Number(req.params.id);
  if (!Number.isInteger(appointmentId) || appointmentId < 1) {
    return res.status(400).json({ message: "Укажите корректную запись" });
  }
  try {
    const appointment = await pool.query(
      `SELECT a.status AS appointment_status, p.status AS payment_status, p.payment_method
       FROM appointments a
       LEFT JOIN payments p ON p.appointment_id = a.appointment_id
       WHERE a.appointment_id = $1
       LIMIT 1`,
      [appointmentId]
    );
    if (appointment.rows.length === 0) {
      return res.status(404).json({ message: "Запись не найдена" });
    }
    if (appointment.rows[0].appointment_status !== "completed") {
      return res.status(409).json({ message: "Сначала отметьте услугу выполненной" });
    }
    if (appointment.rows[0].payment_status === null) {
      return res.status(404).json({ message: "Для записи не найден платёж" });
    }
    if (appointment.rows[0].payment_method !== "at_delivery") {
      return res.status(409).json({ message: "Этот способ оплаты нельзя отметить вручную" });
    }
    if (appointment.rows[0].payment_status !== "pending") {
      return res.status(409).json({ message: "Платёж уже обработан" });
    }

    const result = await pool.query(
      `UPDATE payments p
       SET status = 'completed'
       FROM appointments a
       WHERE p.appointment_id = a.appointment_id
         AND a.appointment_id = $1
         AND a.status = 'completed'
         AND p.status = 'pending'
         AND p.payment_method = 'at_delivery'
       RETURNING p.status AS payment_status`,
      [appointmentId]
    );
    if (result.rows.length === 0) {
      return res.status(409).json({ message: "Статус платежа изменился. Обновите список записей" });
    }
    res.json({ appointment_id: appointmentId, payment_status: result.rows[0].payment_status });
  } catch (error) {
    console.error("Ошибка подтверждения оплаты услуги:", error);
    res.status(500).json({ message: "Ошибка сервера при подтверждении оплаты" });
  }
});

// Возвращает список товаров с учётом доступных пользователю скидок.
app.get("/api/products", async (req, res) => {
  try {
    const currentUser = await getCurrentUser(req);
    const clientUserId =
      currentUser?.is_active && currentUser.role === "client" ? currentUser.user_id : null;
    const query = `
      SELECT p.product_id, p.category_id, p.name, p.description,
             p.price::float8 AS price,
             p.stock_quantity,
             (cpd.discount_percent IS NOT NULL OR p.has_discount) AS has_discount,
             COALESCE(cpd.discount_percent, p.discount_percent) AS discount_percent,
             p.image_url, c.name AS category_name
      FROM products p
      JOIN categories c ON p.category_id = c.category_id
      LEFT JOIN client_product_discounts cpd
        ON cpd.user_id = $1 AND cpd.product_id = p.product_id
      ORDER BY p.product_id ASC
    `;
    const result = await pool.query(query, [clientUserId]);
    console.log(`Найдено товаров: ${result.rows.length}`);
    res.json(result.rows);
  } catch (error) {
    console.error("Ошибка запроса products:", error);
    res.status(500).json({ error: error.message });
  }
});

// Возвращает список категорий каталога.
app.get("/api/categories", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM categories ORDER BY category_id ASC"
    );
    console.log(`Найдено категорий: ${result.rows.length}`);
    res.json(result.rows);
  } catch (error) {
    console.error("Ошибка запроса categories:", error);
    res.status(500).json({ error: error.message });
  }
});

// Возвращает данные текущей пользовательской сессии.
app.get("/api/auth/session", async (req, res) => {
  try {
    const user = await getCurrentUser(req);
    if (!user || !user.is_active) {
      clearSessionCookie(res);
      return res.json({ user: null });
    }
    const publicUser = { ...user };
    delete publicUser.is_active;
    res.json({ user: publicUser });
  } catch (error) {
    console.error("Ошибка проверки сессии:", error);
    res.status(500).json({ message: "Не удалось проверить сессию" });
  }
});

// Завершает текущую сессию и удаляет её cookie.
app.post("/api/auth/logout", async (req, res) => {
  try {
    const token = getSessionToken(req);
    if (token && /^[a-f0-9]{64}$/i.test(token)) {
      const tokenHash = createHash("sha256").update(token).digest("hex");
      await pool.query("DELETE FROM auth_sessions WHERE token_hash = $1", [tokenHash]);
    }
    clearSessionCookie(res);
    res.json({ message: "Вы вышли из аккаунта" });
  } catch (error) {
    console.error("Ошибка завершения сессии:", error);
    res.status(500).json({ message: "Не удалось завершить сессию" });
  }
});

// Создаёт учётную запись пользователя и начинает его сессию.
app.post("/api/auth/register", async (req, res) => {
  const { name, email, password, phone } = req.body || {};
  const normalizedName = typeof name === "string" ? name.trim().replace(/\s+/g, " ") : "";
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  const normalizedPhone = typeof phone === "string" ? phone.trim() : "";

  if (!isValidFullName(normalizedName)) {
    return res.status(400).json({ message: "Введите имя и фамилию" });
  }

  if (hasProhibitedText(normalizedName)) {
    return res.status(400).json({ message: "Имя содержит недопустимые слова" });
  }

  if (
    normalizedName.length > 100 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
    normalizedEmail.length > 100 ||
    typeof phone !== "string" ||
    normalizedPhone.length > 30 ||
    !isValidPhone(normalizedPhone) ||
    typeof password !== "string" ||
    password.length < 8 ||
    password.length > 128
  ) {
    return res.status(400).json({
      message: "Проверьте email и номер телефона (10–15 цифр), пароль должен содержать от 8 до 128 символов",
    });
  }

  try {
    const duplicatePhone = await pool.query(
      `SELECT 1 FROM users
       WHERE regexp_replace(phone, '[^0-9]', '', 'g') = $1
       LIMIT 1`,
      [getPhoneDigits(normalizedPhone)]
    );
    if (duplicatePhone.rows.length > 0) {
      return res.status(409).json({ message: "Этот номер телефона уже используется", field: "phone" });
    }

    const passwordHash = await hashPassword(password);
    const result = await pool.query(
      `INSERT INTO users (role_id, name, email, password, phone)
       SELECT role_id, $1, $2, $3, $4
       FROM roles
       WHERE name = 'client'
       RETURNING user_id, name, email, phone`,
      [normalizedName, normalizedEmail, passwordHash, normalizedPhone || null]
    );

    if (result.rows.length === 0) {
      return res.status(500).json({ message: "В базе данных не настроена роль клиента" });
    }

    await createSession(result.rows[0].user_id, res);
    res.status(201).json({
      ...result.rows[0],
      role: "client",
      discount_coupon: null,
      discount_percent: 0,
    });
  } catch (error) {
    if (error.code === "23505") {
      if (error.constraint === "users_phone_digits_unique") {
        return res.status(409).json({ message: "Этот номер телефона уже используется", field: "phone" });
      }
      return res.status(409).json({ message: "Пользователь с таким email уже существует" });
    }
    console.error("Ошибка при регистрации:", error);
    res.status(500).json({ message: "Ошибка сервера при регистрации" });
  }
});

// Проверяет учётные данные и начинает пользовательскую сессию.
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password) {
      return res.status(400).json({ message: "Заполните email и пароль!" });
    }

    const result = await pool.query(
      `SELECT u.user_id, u.role_id, u.name, u.email, u.phone, u.default_address,
              u.password, u.discount_coupon, u.discount_percent, u.is_active, r.name AS role
       FROM users u
       JOIN roles r ON u.role_id = r.role_id
       WHERE LOWER(u.email) = $1`,
      [email.trim().toLowerCase()]
    );

    if (
      result.rows.length === 0 ||
      !(await verifyPassword(password, result.rows[0].password))
    ) {
      return res.status(401).json({ message: "Неверный email или пароль" });
    }

    const user = result.rows[0];
    if (!user.is_active) {
      return res.status(403).json({ message: "Аккаунт заблокирован. Обратитесь к администратору." });
    }
    if (!user.password.startsWith("scrypt$")) {
      user.password = await hashPassword(password);
      await pool.query("UPDATE users SET password = $1 WHERE user_id = $2", [
        user.password,
        user.user_id,
      ]);
    }
    delete user.password;
    delete user.is_active;
    await createSession(user.user_id, res);
    res.json(user);
  } catch (error) {
    console.error("Ошибка при входе:", error);
    res.status(500).json({ message: "Ошибка сервера при авторизации" });
  }
});

// Создаёт новую категорию каталога.
app.post("/api/categories", requireAdmin, async (req, res) => {
  try {
    const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";

    if (name.toLocaleLowerCase("ru-RU") === "без категории") {
      return res.status(409).json({ message: "Категория «Без категории» уже существует" });
    }

    if (!name || name.length > 100) {
      return res
        .status(400)
        .json({ message: "Название категории должно содержать от 1 до 100 символов" });
    }

    const result = await pool.query(
      `INSERT INTO categories(name) VALUES ($1) RETURNING category_id, name`,
      [name]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Ошибка добавления категории: ", error);
    if (error.code === "23505") {
      return res.status(409).json({ message: "Такая категория уже существует" });
    }
    res
      .status(500)
      .json({ message: "Ошибка сервера при добавлении категории" });
  }
});

// Изменяет название категории каталога.
app.patch("/api/categories/:id", requireAdmin, async (req, res) => {
  const categoryId = Number(req.params.id);
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!Number.isInteger(categoryId) || categoryId < 1 || !name || name.length > 100) {
    return res.status(400).json({ message: "Укажите корректные категорию и название (до 100 символов)" });
  }

  try {
    const current = await pool.query(
      "SELECT name FROM categories WHERE category_id = $1",
      [categoryId]
    );
    if (
      current.rows.length > 0 &&
      current.rows[0].name.toLocaleLowerCase("ru-RU") === "без категории"
    ) {
      return res.status(409).json({ message: "Категорию «Без категории» нельзя переименовать" });
    }
    const result = await pool.query(
      "UPDATE categories SET name = $1 WHERE category_id = $2 RETURNING category_id, name",
      [name, categoryId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Категория не найдена" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ message: "Категория с таким названием уже существует" });
    }
    console.error("Ошибка изменения категории:", error);
    res.status(500).json({ message: "Ошибка сервера при изменении категории" });
  }
});

// Удаляет категорию и переносит её позиции в резервную категорию.
app.delete("/api/categories/:id", requireAdmin, async (req, res) => {
  const categoryId = Number(req.params.id);
  if (!Number.isInteger(categoryId) || categoryId < 1) {
    return res.status(400).json({ message: "Некорректная категория" });
  }
  try {
    const target = await pool.query(
      "SELECT name FROM categories WHERE category_id = $1",
      [categoryId]
    );
    if (target.rows.length === 0) {
      return res.status(404).json({ message: "Категория не найдена" });
    }
    if (target.rows[0].name.toLocaleLowerCase("ru-RU") === "без категории") {
      return res.status(409).json({ message: "Категорию «Без категории» нельзя удалить" });
    }

    const fallback = await pool.query(
      `SELECT category_id FROM categories
       WHERE lower(btrim(name)) = 'без категории'
       ORDER BY category_id ASC LIMIT 1`
    );
    if (fallback.rows.length === 0) {
      return res.status(500).json({ message: "Категория «Без категории» не найдена" });
    }
    const fallbackId = fallback.rows[0].category_id;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE products SET category_id = $1 WHERE category_id = $2", [fallbackId, categoryId]);
      await client.query("UPDATE services SET category_id = $1 WHERE category_id = $2", [fallbackId, categoryId]);
      await client.query("DELETE FROM categories WHERE category_id = $1", [categoryId]);
      await client.query("COMMIT");
      res.json({ message: "Категория удалена. Позиции перенесены в «Без категории»" });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Ошибка удаления категории:", error);
    res.status(500).json({ message: "Ошибка сервера при удалении категории" });
  }
});

const catalogDefinitions = {
  product: { table: "products", idColumn: "product_id" },
  service: { table: "services", idColumn: "service_id" },
};

// Проверяет данные товара или услуги перед сохранением в каталоге.
const validateCatalogPayload = (type, body) => {
  if (!catalogDefinitions[type]) return { error: "Выберите товар или услугу" };
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description = typeof body?.description === "string" ? body.description.trim() : "";
  const categoryId = body?.category_id === "" || body?.category_id == null
    ? null
    : Number(body.category_id);
  const price = Number(body?.price);
  const imageUrl = typeof body?.image_url === "string" ? body.image_url.trim() : "";
  const duration = Number(body?.duration);
  const stockQuantity = type === "product" ? Number(body?.stock_quantity ?? 100) : null;

  if (!name || name.length > 150) {
    return { error: "Название должно содержать от 1 до 150 символов" };
  }
  if (hasProhibitedText(name) || hasProhibitedText(description)) {
    return { error: "Название или описание содержит недопустимые слова" };
  }
  if (description.length > 5000) {
    return { error: "Описание не должно превышать 5000 символов" };
  }
  if (!Number.isFinite(price) || price <= 0 || price > 100000000) {
    return { error: "Цена должна быть больше 0 и не превышать 100 000 000" };
  }
  if (type === "product" && (!Number.isInteger(stockQuantity) || stockQuantity < 0 || stockQuantity > 100000)) {
    return { error: "Количество на складе должно быть целым числом от 0 до 100 000" };
  }
  if (imageUrl.length > 2000) {
    return { error: "Ссылка на изображение слишком длинная" };
  }
  if (imageUrl) {
    try {
      const parsedUrl = new URL(imageUrl);
      if (!["http:", "https:"].includes(parsedUrl.protocol)) {
        return { error: "Ссылка на изображение должна начинаться с http:// или https://" };
      }
      const extension = parsedUrl.pathname.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
      const allowedExtensions = ["jpg", "jpeg", "png", "webp", "gif", "avif"];
      const extensionlessImageHosts = ["images.unsplash.com", "avatars.mds.yandex.net"];
      if (
        (extension && !allowedExtensions.includes(extension)) ||
        (!extension && !extensionlessImageHosts.includes(parsedUrl.hostname.toLowerCase()))
      ) {
        return { error: "Поддерживаются только изображения JPG, PNG, WEBP, GIF и AVIF" };
      }
    } catch {
      return { error: "Укажите корректную ссылку на изображение" };
    }
  }
  if (type === "service" && (!Number.isInteger(duration) || duration < 1 || duration > 1440)) {
    return { error: "Длительность услуги должна быть от 1 до 1440 минут" };
  }
  return {
    value: {
      name,
      description,
      categoryId,
      price,
      imageUrl,
      duration,
      stockQuantity,
    },
  };
};

// Добавляет товар или услугу в каталог.
app.post("/api/admin/catalog/:type", requireAdmin, async (req, res) => {
  const type = req.params.type;
  const definition = catalogDefinitions[type];
  const validation = validateCatalogPayload(type, req.body);
  if (!definition || validation.error) {
    return res.status(400).json({ message: validation.error || "Тип позиции не поддерживается" });
  }

  try {
    let categoryId = validation.value.categoryId;
    if (categoryId) {
      const category = await pool.query("SELECT 1 FROM categories WHERE category_id = $1", [categoryId]);
      if (category.rows.length === 0) {
        return res.status(400).json({ message: "Выбранная категория не найдена" });
      }
    } else {
      const fallback = await pool.query(
        `SELECT category_id FROM categories
         WHERE lower(btrim(name)) = 'без категории'
         ORDER BY category_id ASC LIMIT 1`
      );
      categoryId = fallback.rows[0]?.category_id;
    }
    if (!categoryId) {
      return res.status(500).json({ message: "Категория «Без категории» не найдена" });
    }

    const { name, description, price, imageUrl, duration, stockQuantity } = validation.value;
    const result = type === "service"
      ? await pool.query(
          `INSERT INTO services (category_id, name, description, duration, price, has_discount, discount_percent, image_url)
           VALUES ($1, $2, $3, $4, $5, FALSE, 0, $6)
           RETURNING service_id, category_id, name, description, duration, price::float8 AS price, image_url`,
          [categoryId, name, description, duration, price, imageUrl]
        )
      : await pool.query(
          `INSERT INTO products (category_id, name, description, price, stock_quantity, has_discount, discount_percent, image_url)
           VALUES ($1, $2, $3, $4, $5, FALSE, 0, $6)
           RETURNING product_id, category_id, name, description, price::float8 AS price, stock_quantity, image_url`,
          [categoryId, name, description, price, stockQuantity, imageUrl]
        );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Ошибка добавления позиции каталога:", error);
    res.status(500).json({ message: "Ошибка сервера при добавлении позиции каталога" });
  }
});

// Изменяет данные товара или услуги в каталоге.
app.patch("/api/admin/catalog/:type/:id", requireAdmin, async (req, res) => {
  const type = req.params.type;
  const definition = catalogDefinitions[type];
  const itemId = Number(req.params.id);
  const validation = validateCatalogPayload(type, req.body);
  if (!definition || !Number.isInteger(itemId) || itemId < 1 || validation.error) {
    return res.status(400).json({
      message: validation.error || "Укажите корректный товар или услугу",
    });
  }

  try {
    let categoryId = validation.value.categoryId;
    if (categoryId) {
      const category = await pool.query("SELECT 1 FROM categories WHERE category_id = $1", [categoryId]);
      if (category.rows.length === 0) {
        return res.status(400).json({ message: "Выбранная категория не найдена" });
      }
    } else {
      const fallback = await pool.query(
        `SELECT category_id FROM categories
         WHERE lower(btrim(name)) = 'без категории'
         ORDER BY category_id ASC LIMIT 1`
      );
      categoryId = fallback.rows[0]?.category_id;
    }
    if (!categoryId) {
      return res.status(500).json({ message: "Категория «Без категории» не найдена" });
    }
    const { name, description, price, imageUrl, duration, stockQuantity } = validation.value;
    const result = type === "service"
      ? await pool.query(
          `UPDATE services
           SET category_id = $1, name = $2, description = $3, duration = $4, price = $5, image_url = $6
           WHERE service_id = $7
           RETURNING service_id, category_id, name, description, duration, price::float8 AS price, image_url`,
          [categoryId, name, description, duration, price, imageUrl, itemId]
        )
      : await pool.query(
          `UPDATE products
           SET category_id = $1, name = $2, description = $3, price = $4, stock_quantity = $5, image_url = $6
           WHERE product_id = $7
           RETURNING product_id, category_id, name, description, price::float8 AS price, stock_quantity, image_url`,
          [categoryId, name, description, price, stockQuantity, imageUrl, itemId]
        );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Позиция каталога не найдена" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Ошибка изменения позиции каталога:", error);
    res.status(500).json({ message: "Ошибка сервера при изменении позиции каталога" });
  }
});

// Удаляет товар или услугу из каталога.
app.delete("/api/admin/catalog/:type/:id", requireAdmin, async (req, res) => {
  const definition = catalogDefinitions[req.params.type];
  const itemId = Number(req.params.id);
  if (!definition || !Number.isInteger(itemId) || itemId < 1) {
    return res.status(400).json({ message: "Укажите корректный товар или услугу" });
  }

  try {
    if (req.params.type === "product") {
      const linkedOrder = await pool.query(
        "SELECT 1 FROM order_items WHERE product_id = $1 LIMIT 1",
        [itemId]
      );
      if (linkedOrder.rows.length > 0) {
        return res.status(409).json({
          message: "Нельзя удалить товар, который уже входит в заказ",
        });
      }
    } else {
      const linkedAppointment = await pool.query(
        "SELECT 1 FROM appointments WHERE service_id = $1 LIMIT 1",
        [itemId]
      );
      if (linkedAppointment.rows.length > 0) {
        return res.status(409).json({
          message: "Нельзя удалить услугу, по которой уже есть записи или заказы",
        });
      }
    }

    const result = await pool.query(
      `DELETE FROM ${definition.table} WHERE ${definition.idColumn} = $1 RETURNING ${definition.idColumn}`,
      [itemId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Позиция каталога не найдена" });
    }
    res.json({ message: "Позиция каталога удалена" });
  } catch (error) {
    console.error("Ошибка удаления позиции каталога:", error);
    res.status(500).json({ message: "Ошибка сервера при удалении позиции каталога" });
  }
});

// Возвращает старые купоны, назначенные пользователям.
app.get("/api/coupons", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT discount_coupon AS code, discount_percent AS percent, COUNT(*)::int AS users_count
       FROM users
       WHERE discount_coupon IS NOT NULL AND btrim(discount_coupon) <> ''
       GROUP BY discount_coupon, discount_percent
       ORDER BY discount_coupon, discount_percent DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Ошибка загрузки купонов:", error);
    res.status(500).json({ message: "Ошибка сервера при загрузке купонов" });
  }
});

// Возвращает список купонов для административного управления.
app.get("/api/admin/coupons", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.coupon_id, c.code, c.percent, c.usage_type, c.is_active,
              c.expires_at, c.min_order::float8 AS min_order,
              (SELECT COUNT(*)::int
               FROM coupon_redemptions r
               WHERE r.coupon_id = c.coupon_id) AS uses_count,
              (SELECT COUNT(DISTINCT r.user_id)::int
               FROM coupon_redemptions r
               JOIN coupon_assignments a
                 ON a.coupon_id = r.coupon_id AND a.user_id = r.user_id
               WHERE r.coupon_id = c.coupon_id) AS assigned_uses_count,
              COALESCE(
                (SELECT array_agg(DISTINCT r.user_id ORDER BY r.user_id)
                 FROM coupon_redemptions r
                 WHERE r.coupon_id = c.coupon_id),
                ARRAY[]::integer[]
              ) AS redeemed_user_ids,
              COALESCE(
                (SELECT array_agg(a.user_id ORDER BY a.user_id)
                 FROM coupon_assignments a
                 WHERE a.coupon_id = c.coupon_id),
                ARRAY[]::integer[]
              ) AS assigned_user_ids
       FROM coupons c
       ORDER BY c.created_at DESC, c.coupon_id DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Ошибка загрузки купонов админ-панели:", error);
    res.status(500).json({ message: "Не удалось загрузить купоны" });
  }
});

// Проверяет список идентификаторов пользователей для назначения купона.
const validateCouponUserIds = (userIds) => {
  if (
    !Array.isArray(userIds) ||
    userIds.length > 1000 ||
    !userIds.every((userId) => Number.isInteger(userId) && userId > 0 && userId <= 2147483647)
  ) {
    return { error: "Выберите корректных клиентов" };
  }
  return { value: [...new Set(userIds)] };
};

// Проверяет существование и доступность пользователей для назначения купона.
const validateCouponClients = async (client, userIds) => {
  if (userIds.length === 0) return;
  const result = await client.query(
    `SELECT COUNT(*)::int AS client_count
     FROM users u
     JOIN roles r ON r.role_id = u.role_id
     WHERE u.user_id = ANY($1::int[]) AND r.name = 'client'`,
    [userIds]
  );
  if (Number(result.rows[0].client_count) !== userIds.length) {
    throw Object.assign(new Error("Выберите только существующих клиентов"), { status: 400 });
  }
};

// Заменяет список пользователей, которым назначен купон.
const replaceCouponAssignments = async (client, couponId, userIds) => {
  await client.query("DELETE FROM coupon_assignments WHERE coupon_id = $1", [couponId]);
  if (userIds.length > 0) {
    await client.query(
      `INSERT INTO coupon_assignments (coupon_id, user_id)
       SELECT $1, selected.user_id
       FROM unnest($2::int[]) AS selected(user_id)`,
      [couponId, userIds]
    );
  }
};

// Создаёт купон и назначает его выбранным пользователям.
app.post("/api/admin/coupons", requireAdmin, async (req, res) => {
  const validation = validateCouponPayload(req.body);
  if (validation.error) return res.status(400).json({ message: validation.error });
  const assignmentValidation = validateCouponUserIds(req.body?.assigned_user_ids ?? []);
  if (assignmentValidation.error) {
    return res.status(400).json({ message: assignmentValidation.error });
  }
  const { code, percent, usageType, isActive, expiresAt, minOrder } = validation.value;
  const userIds = assignmentValidation.value;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await validateCouponClients(client, userIds);
    const result = await client.query(
      `INSERT INTO coupons (code, percent, usage_type, is_active, expires_at, min_order)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING coupon_id, code, percent, usage_type, is_active, expires_at,
                 min_order::float8 AS min_order`,
      [code, percent, usageType, isActive, expiresAt, minOrder]
    );
    const coupon = result.rows[0];
    await replaceCouponAssignments(client, coupon.coupon_id, userIds);
    await client.query("COMMIT");
    res.status(201).json({ ...coupon, assigned_user_ids: userIds });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      return res.status(409).json({ message: "Купон с таким кодом уже существует" });
    }
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error("Ошибка создания купона:", error);
    res.status(500).json({ message: "Не удалось создать купон" });
  } finally {
    client.release();
  }
});

// Обновляет настройки и список назначений купона.
app.patch("/api/admin/coupons/:id", requireAdmin, async (req, res) => {
  const couponId = Number(req.params.id);
  const validation = validateCouponPayload(req.body);
  if (!Number.isInteger(couponId) || couponId < 1 || validation.error) {
    return res.status(400).json({ message: validation.error || "Укажите корректный купон" });
  }
  const assignmentsProvided = Object.prototype.hasOwnProperty.call(req.body || {}, "assigned_user_ids");
  const assignmentValidation = assignmentsProvided
    ? validateCouponUserIds(req.body.assigned_user_ids)
    : { value: null };
  if (assignmentValidation.error) {
    return res.status(400).json({ message: assignmentValidation.error });
  }
  const { code, percent, usageType, isActive, expiresAt, minOrder } = validation.value;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (assignmentsProvided) {
      await validateCouponClients(client, assignmentValidation.value);
    }
    const result = await client.query(
      `UPDATE coupons
       SET code = $1, percent = $2, usage_type = $3, is_active = $4,
           expires_at = $5, min_order = $6
       WHERE coupon_id = $7
       RETURNING coupon_id, code, percent, usage_type, is_active, expires_at,
                 min_order::float8 AS min_order`,
      [code, percent, usageType, isActive, expiresAt, minOrder, couponId]
    );
    if (result.rows.length === 0) {
      throw Object.assign(new Error("Купон не найден"), { status: 404 });
    }
    if (assignmentsProvided) {
      await replaceCouponAssignments(client, couponId, assignmentValidation.value);
    }
    await client.query("COMMIT");
    res.json({
      ...result.rows[0],
      assigned_user_ids: assignmentsProvided ? assignmentValidation.value : undefined,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      return res.status(409).json({ message: "Купон с таким кодом уже существует" });
    }
    if (error.status) return res.status(error.status).json({ message: error.message });
    console.error("Ошибка изменения купона:", error);
    res.status(500).json({ message: "Не удалось изменить купон" });
  } finally {
    client.release();
  }
});

// Удаляет купон из административного управления.
app.delete("/api/admin/coupons/:id", requireAdmin, async (req, res) => {
  const couponId = Number(req.params.id);
  if (!Number.isInteger(couponId) || couponId < 1) {
    return res.status(400).json({ message: "Укажите корректный купон" });
  }
  try {
    const result = await pool.query(
      "DELETE FROM coupons WHERE coupon_id = $1 RETURNING coupon_id",
      [couponId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Купон не найден" });
    }
    res.json({ message: "Купон удалён" });
  } catch (error) {
    if (error.code === "23503") {
      return res.status(409).json({ message: "Использованный купон нельзя удалить; его можно отключить" });
    }
    console.error("Ошибка удаления купона:", error);
    res.status(500).json({ message: "Не удалось удалить купон" });
  }
});

// Возвращает сохранённое содержимое корзины пользователя.
app.get("/api/cart", requireUser, async (req, res) => {
  if (req.user.role === "admin") {
    return res.status(403).json({ message: "Корзина недоступна администраторам" });
  }
  try {
    const result = await pool.query(
      `SELECT 'product'::text AS type, p.product_id AS id, p.category_id, p.name, p.image_url,
              p.price::float8 AS price,
              p.stock_quantity,
              COALESCE(cpd.discount_percent, CASE WHEN p.has_discount THEN p.discount_percent ELSE 0 END)::integer
                AS discount_percent,
              ROUND(
                p.price * (
                  1 - COALESCE(cpd.discount_percent, CASE WHEN p.has_discount THEN p.discount_percent ELSE 0 END)::numeric / 100
                )
              )::float8 AS "finalPrice",
              LEAST(ci.quantity, p.stock_quantity) AS quantity
       FROM cart_items ci
       JOIN products p ON p.product_id = ci.product_id
       LEFT JOIN client_product_discounts cpd
         ON cpd.user_id = ci.user_id AND cpd.product_id = p.product_id
       WHERE ci.user_id = $1 AND ci.product_id IS NOT NULL AND p.stock_quantity > 0
       UNION ALL
       SELECT 'service'::text, s.service_id, s.category_id, s.name, s.image_url,
              s.price::float8,
              NULL::integer AS stock_quantity,
              CASE WHEN s.has_discount THEN s.discount_percent ELSE 0 END::integer,
              CASE WHEN s.has_discount
                   THEN ROUND(s.price * (1 - s.discount_percent::numeric / 100))
                   ELSE s.price END::float8,
              ci.quantity
       FROM cart_items ci
       JOIN services s ON s.service_id = ci.service_id
       WHERE ci.user_id = $1 AND ci.service_id IS NOT NULL
       ORDER BY type, id`,
      [req.user.user_id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Ошибка загрузки корзины:", error);
    res.status(500).json({ message: "Ошибка сервера при загрузке корзины" });
  }
});

// Возвращает пользователю доступные ему купоны.
app.get("/api/coupons/available", requireUser, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT c.coupon_id, c.code, c.percent, c.usage_type,
              c.expires_at, c.min_order::float8 AS min_order,
              CASE WHEN EXISTS (
                SELECT 1 FROM coupon_assignments a WHERE a.coupon_id = c.coupon_id
              ) THEN 'personal' ELSE 'all' END AS audience
       FROM coupons c
       WHERE c.is_active
         AND (c.expires_at IS NULL OR c.expires_at > CURRENT_TIMESTAMP)
         AND (
           NOT EXISTS (
             SELECT 1 FROM coupon_assignments a WHERE a.coupon_id = c.coupon_id
           )
           OR EXISTS (
             SELECT 1 FROM coupon_assignments a
             WHERE a.coupon_id = c.coupon_id AND a.user_id = $1
           )
         )
         AND (
           c.usage_type <> 'one_time'
           OR (
             EXISTS (
               SELECT 1 FROM coupon_assignments a WHERE a.coupon_id = c.coupon_id
             )
             AND NOT EXISTS (
               SELECT 1 FROM coupon_redemptions r
               WHERE r.coupon_id = c.coupon_id AND r.user_id = $1
             )
           )
           OR (
             NOT EXISTS (
               SELECT 1 FROM coupon_assignments a WHERE a.coupon_id = c.coupon_id
             )
             AND NOT EXISTS (
               SELECT 1 FROM coupon_redemptions r WHERE r.coupon_id = c.coupon_id
             )
           )
         )
       ORDER BY c.created_at DESC, c.coupon_id DESC`,
      [req.user.user_id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Ошибка загрузки доступных купонов:", error);
    res.status(500).json({ message: "Не удалось загрузить доступные купоны" });
  }
});

// Проверяет купон и рассчитывает скидку для текущей корзины.
app.post("/api/coupons/validate", requireUser, async (req, res) => {
  const code = typeof req.body?.code === "string" ? req.body.code.trim().toUpperCase() : "";
  const items = req.body?.items;
  if (!code || !Array.isArray(items) || items.length === 0 || items.length > 100) {
    return res.status(400).json({ message: "Укажите код купона и позиции корзины" });
  }
  try {
    const itemKeys = new Set();
    let subtotal = 0;
    const lineSubtotals = [];
    for (const item of items) {
      const type = item?.type;
      const id = Number(item?.id);
      const quantity = Number(item?.quantity);
      const key = `${type}:${id}`;
      if (
        !["product", "service"].includes(type) ||
        !Number.isInteger(id) ||
        id < 1 ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > 100 ||
        itemKeys.has(key)
      ) {
        return res.status(400).json({ message: "В корзине есть некорректные позиции" });
      }
      itemKeys.add(key);
      const result = type === "product"
        ? await pool.query(
            `SELECT p.name, p.price,
                    (cpd.discount_percent IS NOT NULL OR p.has_discount) AS has_discount,
                    COALESCE(cpd.discount_percent, CASE WHEN p.has_discount THEN p.discount_percent ELSE 0 END)
                      AS discount_percent,
                    p.stock_quantity
             FROM products p
             LEFT JOIN client_product_discounts cpd
               ON cpd.user_id = $2 AND cpd.product_id = p.product_id
             WHERE p.product_id = $1`,
            [id, req.user.user_id]
          )
        : await pool.query(
            "SELECT name, price, has_discount, discount_percent FROM services WHERE service_id = $1",
            [id]
          );
      if (result.rows.length === 0) {
        return res.status(400).json({ message: "Одна из позиций больше недоступна" });
      }
      if (type === "product" && quantity > Number(result.rows[0].stock_quantity)) {
        return res.status(400).json({
          message: `На складе доступно только ${result.rows[0].stock_quantity} шт. товара «${result.rows[0].name}»`,
        });
      }
      const lineSubtotal = finalPrice(result.rows[0]) * quantity;
      subtotal += lineSubtotal;
      lineSubtotals.push(lineSubtotal);
    }

    const result = await pool.query(
      `SELECT c.coupon_id, c.code, c.percent, c.usage_type, c.is_active, c.expires_at,
              c.min_order::float8 AS min_order,
              EXISTS (
                SELECT 1 FROM coupon_assignments a WHERE a.coupon_id = c.coupon_id
              ) AS is_restricted,
              EXISTS (
                SELECT 1 FROM coupon_assignments a
                WHERE a.coupon_id = c.coupon_id AND a.user_id = $2
              ) AS is_assigned
       FROM coupons c
       WHERE upper(c.code) = $1`,
      [code, req.user.user_id]
    );
    const coupon = result.rows[0];
    if (!coupon) {
      return res.status(400).json({ message: "Купон не найден или отключён" });
    }
    if (coupon.is_restricted && !coupon.is_assigned) {
      return res.status(400).json({ message: "Купон не назначен вашему аккаунту" });
    }
    if (coupon.expires_at && new Date(coupon.expires_at) <= new Date()) {
      return res.status(400).json({ message: "Срок действия купона истёк" });
    }
    if (coupon.usage_type === "one_time") {
      const redemption = coupon.is_restricted
        ? await pool.query(
            "SELECT 1 FROM coupon_redemptions WHERE coupon_id = $1 AND user_id = $2 LIMIT 1",
            [coupon.coupon_id, req.user.user_id]
          )
        : await pool.query(
            "SELECT 1 FROM coupon_redemptions WHERE coupon_id = $1 LIMIT 1",
            [coupon.coupon_id]
          );
      if (redemption.rows.length > 0) {
        return res.status(400).json({ message: "Одноразовый купон исчерпан: он уже использован" });
      }
    }
    if (!coupon.is_active) {
      return res.status(400).json({ message: "Купон отключён" });
    }
    if (subtotal < Number(coupon.min_order)) {
      return res.status(400).json({
        message: `Минимальная сумма заказа для купона — ${coupon.min_order} ₽`,
      });
    }
    const total = lineSubtotals.reduce(
      (sum, lineSubtotal) => sum + Math.round(lineSubtotal * (1 - Number(coupon.percent) / 100)),
      0
    );
    const discount = subtotal - total;
    res.json({
      code: coupon.code,
      percent: Number(coupon.percent),
      subtotal,
      discount,
      total,
    });
  } catch (error) {
    console.error("Ошибка проверки купона:", error);
    res.status(500).json({ message: "Не удалось проверить купон" });
  }
});

// Сохраняет содержимое корзины пользователя.
app.put("/api/cart", requireUser, async (req, res) => {
  if (req.user.role === "admin") {
    return res.status(403).json({ message: "Корзина недоступна администраторам" });
  }
  const { items } = req.body || {};
  if (
    !Array.isArray(items) ||
    items.length > 100 ||
    !items.every((item) =>
      item &&
      ["product", "service"].includes(item.type) &&
      Number.isInteger(Number(item.id)) &&
      Number(item.id) > 0 &&
      Number.isInteger(Number(item.quantity)) &&
      Number(item.quantity) >= 1 &&
      Number(item.quantity) <= 100
    )
  ) {
    return res.status(400).json({ message: "Некорректные данные корзины" });
  }

  const keys = items.map((item) => `${item.type}:${Number(item.id)}`);
  if (new Set(keys).size !== keys.length) {
    return res.status(400).json({ message: "В корзине есть повторяющиеся позиции" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT user_id FROM users WHERE user_id = $1 FOR UPDATE", [
      req.user.user_id,
    ]);
    for (const item of items) {
      const table = item.type === "product" ? "products" : "services";
      const idColumn = item.type === "product" ? "product_id" : "service_id";
      const found = await client.query(
        `SELECT ${item.type === "product" ? "stock_quantity" : "1 AS stock_quantity"} FROM ${table} WHERE ${idColumn} = $1`,
        [Number(item.id)]
      );
      if (found.rows.length === 0) {
        throw Object.assign(new Error("Товар или услуга не найдены"), { status: 400 });
      }
      if (item.type === "product" && Number(item.quantity) > Number(found.rows[0].stock_quantity)) {
        throw Object.assign(new Error(`На складе доступно только ${found.rows[0].stock_quantity} шт.`), { status: 400 });
      }
    }

    await client.query("DELETE FROM cart_items WHERE user_id = $1", [req.user.user_id]);
    for (const item of items) {
      await client.query(
        `INSERT INTO cart_items (user_id, product_id, service_id, quantity)
         VALUES ($1, $2, $3, $4)`,
        [
          req.user.user_id,
          item.type === "product" ? Number(item.id) : null,
          item.type === "service" ? Number(item.id) : null,
          Number(item.quantity),
        ]
      );
    }
    await client.query("COMMIT");
    res.json({ message: "Корзина сохранена" });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Ошибка сохранения корзины:", error);
    res.status(error.status || 500).json({
      message: error.status ? error.message : "Ошибка сервера при сохранении корзины",
    });
  } finally {
    client.release();
  }
});

// Возвращает администратору список пользователей.
app.get("/api/users", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.user_id, u.name, u.email, u.is_active,
              u.discount_coupon, u.discount_percent, r.name AS role
       FROM users u JOIN roles r ON u.role_id = r.role_id
       ORDER BY u.user_id ASC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Ошибка запроса users:", error);
    res.status(500).json({ error: error.message });
  }
});

// Блокирует или разблокирует учётную запись пользователя.
app.patch("/api/users/:id/status", requireAdmin, async (req, res) => {
  const userId = Number(req.params.id);
  const isActive = req.body?.is_active;
  if (!Number.isInteger(userId) || userId < 1 || typeof isActive !== "boolean") {
    return res.status(400).json({ message: "Укажите пользователя и корректный статус" });
  }
  if (userId === req.user.user_id) {
    return res.status(400).json({ message: "Нельзя изменить статус собственного аккаунта" });
  }
  try {
    const result = await pool.query(
      `UPDATE users u
       SET is_active = $1
       FROM roles r
       WHERE u.user_id = $2 AND r.role_id = u.role_id AND r.name = 'client'
       RETURNING u.user_id, u.is_active`,
      [isActive, userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Пользователь не найден или его нельзя заблокировать" });
    }
    if (!isActive) {
      await pool.query("DELETE FROM auth_sessions WHERE user_id = $1", [userId]);
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Ошибка изменения статуса пользователя:", error);
    res.status(500).json({ message: "Ошибка сервера при изменении статуса пользователя" });
  }
});

// Назначает персональную скидку одному пользователю.
app.patch("/api/users/discount", requireAdmin, async (req, res) => {
  try {
    const { email, discount_coupon, discount_percent } = req.body || {};
    const percent = Number(discount_percent);
    const coupon = typeof discount_coupon === "string" ? discount_coupon.trim() : "";

    if (!Number.isInteger(percent) || percent < 0 || percent > 99) {
      return res.status(400).json({ message: "Скидка должна быть целым числом от 0 до 99%" });
    }
    if (percent > 0 && (!coupon || coupon.length > 50)) {
      return res.status(400).json({ message: "Укажите код купона длиной до 50 символов" });
    }

    const result = await pool.query(
      `UPDATE users
       SET discount_coupon = $1, discount_percent = $2
       WHERE email = $3
       RETURNING user_id, email, discount_coupon, discount_percent`,
      [percent > 0 ? coupon : null, percent, email]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Пользователь не найден" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Ошибка обновления купона: ", error);
    res
      .status(500)
      .json({ message: "Ошибка сервера при обновлении скидки" });
  }
});

// Массово назначает или снимает скидку для пользователей.
app.patch("/api/users/discount/bulk", requireAdmin, async (req, res) => {
  try {
    const { user_ids, discount_coupon, discount_percent } = req.body || {};
    const percent = Number(discount_percent);

    if (
      !Array.isArray(user_ids) ||
      user_ids.length === 0 ||
      !user_ids.every((id) => Number.isInteger(id) && id > 0 && id <= 2147483647)
    ) {
      return res.status(400).json({ message: "Выберите хотя бы одного корректного клиента" });
    }

    if (!Number.isInteger(percent) || percent < 0 || percent > 99) {
      return res.status(400).json({ message: "Скидка должна быть целым числом от 0 до 99%" });
    }

    const coupon = typeof discount_coupon === "string" ? discount_coupon.trim() : "";
    if (percent > 0 && (!coupon || coupon.length > 50)) {
      return res.status(400).json({ message: "Укажите код купона" });
    }

    const userIds = [...new Set(user_ids)];
    const result = await pool.query(
      `UPDATE users AS u
       SET discount_coupon = $1, discount_percent = $2
       WHERE u.user_id = ANY($3::int[])
         AND EXISTS (
           SELECT 1 FROM roles r
           WHERE r.role_id = u.role_id AND r.name = 'client'
         )
         AND (
           SELECT COUNT(*)
           FROM users selected
           JOIN roles selected_role ON selected_role.role_id = selected.role_id
           WHERE selected.user_id = ANY($3::int[])
             AND selected_role.name = 'client'
         ) = cardinality($3::int[])
       RETURNING u.user_id, u.email, u.discount_coupon, u.discount_percent`,
      [percent > 0 ? coupon : null, percent, userIds]
    );

    if (result.rows.length !== userIds.length) {
      return res.status(400).json({ message: "Выберите только существующих клиентов" });
    }

    res.json(result.rows);
  } catch (error) {
    console.error("Ошибка массового обновления купонов:", error);
    res.status(500).json({ message: "Ошибка сервера при массовом обновлении купонов" });
  }
});

// Назначает скидку на выбранные товары для указанных клиентов.
app.patch("/api/products/discount/bulk", requireAdmin, async (req, res) => {
  try {
    const { user_ids, product_ids, discount_percent } = req.body || {};
    const percent = Number(discount_percent);
    // Проверяет, что каждый идентификатор относится к выбранному товару.
    const isValidIds = (ids) =>
      Array.isArray(ids) &&
      ids.length > 0 &&
      ids.every((id) => Number.isInteger(id) && id > 0 && id <= 2147483647);

    if (!isValidIds(user_ids) || !isValidIds(product_ids)) {
      return res.status(400).json({ message: "Выберите хотя бы одного клиента и один товар" });
    }
    if (!Number.isInteger(percent) || percent < 0 || percent > 99) {
      return res.status(400).json({ message: "Скидка должна быть целым числом от 0 до 99%" });
    }

    const userIds = [...new Set(user_ids)];
    const productIds = [...new Set(product_ids)];
    const selection = await pool.query(
      `SELECT
         (SELECT COUNT(*)
          FROM users u
          JOIN roles r ON r.role_id = u.role_id
          WHERE u.user_id = ANY($1::int[]) AND r.name = 'client') AS client_count,
         (SELECT COUNT(*)
          FROM products p
          WHERE p.product_id = ANY($2::int[])) AS product_count`,
      [userIds, productIds]
    );

    if (
      Number(selection.rows[0].client_count) !== userIds.length ||
      Number(selection.rows[0].product_count) !== productIds.length
    ) {
      return res.status(400).json({ message: "Выберите только существующих клиентов и товары" });
    }

    if (percent === 0) {
      await pool.query(
        `DELETE FROM client_product_discounts
         WHERE user_id = ANY($1::int[]) AND product_id = ANY($2::int[])`,
        [userIds, productIds]
      );
    } else {
      await pool.query(
        `INSERT INTO client_product_discounts (user_id, product_id, discount_percent)
         SELECT selected_users.user_id, selected_products.product_id, $3
         FROM unnest($1::int[]) AS selected_users(user_id)
         CROSS JOIN unnest($2::int[]) AS selected_products(product_id)
         ON CONFLICT (user_id, product_id)
         DO UPDATE SET discount_percent = EXCLUDED.discount_percent`,
        [userIds, productIds, percent]
      );
    }

    res.json({
      updated: userIds.length * productIds.length,
      discount_percent: percent,
    });
  } catch (error) {
    console.error("Ошибка массового обновления скидок на товары:", error);
    res.status(500).json({ message: "Ошибка сервера при массовом обновлении скидок" });
  }
});

// Создаёт обработчик изменения скидки для выбранного типа каталога.
const updateDiscount = (table, idColumn) => async (req, res) => {
  try {
    const { id } = req.params;
    const percent = Number(req.body?.discount_percent);
    const hasDiscount = percent > 0;

    if (!Number.isInteger(percent) || percent < 0 || percent > 99) {
      return res.status(400).json({ message: "Скидка должна быть целым числом от 0 до 99%" });
    }

    const result = await pool.query(
      `UPDATE ${table}
       SET has_discount = $1, discount_percent = $2
       WHERE ${idColumn} = $3 RETURNING *`,
      [hasDiscount, percent, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "Не найдено" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(`Ошибка обновления скидки (${table}):`, error);
    res.status(500).json({ error: error.message });
  }
};

// Обновляет скидку для выбранной услуги.
app.patch("/api/services/:id/discount", requireAdmin, updateDiscount("services", "service_id"));
// Обновляет скидку для выбранного товара.
app.patch("/api/products/:id/discount", requireAdmin, updateDiscount("products", "product_id"));

// Оформляет заказ с проверкой остатков и создаёт записи оплат в одной транзакции.
app.post("/api/checkout", requireUser, async (req, res) => {
  const { items, delivery_address, delivery_date, coupon_code } = req.body || {};

  if (req.user.role === "admin") {
    return res.status(403).json({ message: "Оформление заказов администраторам недоступно" });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: "Корзина пуста" });
  }
  const itemKeys = items.map((item) => `${item?.type}:${Number(item?.id)}`);
  if (new Set(itemKeys).size !== itemKeys.length) {
    return res.status(400).json({ message: "В заказе есть повторяющиеся позиции" });
  }
  const address = typeof delivery_address === "string" ? delivery_address.trim() : "";
  if (!address || address.length > 500) {
    return res.status(400).json({ message: "Укажите адрес доставки (до 500 символов)" });
  }
  if (typeof delivery_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(delivery_date)) {
    return res.status(400).json({ message: "Укажите корректную дату доставки" });
  }
  const parsedDeliveryDate = new Date(`${delivery_date}T00:00:00.000Z`);
  if (
    Number.isNaN(parsedDeliveryDate.getTime()) ||
    parsedDeliveryDate.toISOString().slice(0, 10) !== delivery_date
  ) {
    return res.status(400).json({ message: "Укажите существующую дату доставки" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const dateCheck = await client.query(
      "SELECT $1::date >= CURRENT_DATE AS valid, $1::date::text AS normalized",
      [delivery_date]
    );
    if (!dateCheck.rows[0].valid || dateCheck.rows[0].normalized !== delivery_date) {
      throw Object.assign(new Error("Дата доставки не может быть раньше сегодняшнего дня"), { status: 400 });
    }

    const lines = [];
    await client.query(
      "UPDATE users SET default_address = $1 WHERE user_id = $2",
      [address, req.user.user_id]
    );

    for (const item of items) {
      const quantity = Number(item.quantity);
      const id = Number(item.id);
      if (
        !["product", "service"].includes(item.type) ||
        !Number.isInteger(id) ||
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > 100
      ) {
        throw Object.assign(new Error("Некорректные данные корзины"), { status: 400 });
      }

      const table = item.type === "service" ? "services" : "products";
      const idColumn = item.type === "service" ? "service_id" : "product_id";
      const found =
        item.type === "product"
          ? await client.query(
              `SELECT p.name, p.price, p.stock_quantity,
                      (cpd.discount_percent IS NOT NULL OR p.has_discount) AS has_discount,
                      COALESCE(cpd.discount_percent, CASE WHEN p.has_discount THEN p.discount_percent ELSE 0 END)
                        AS discount_percent
               FROM products p
               LEFT JOIN client_product_discounts cpd
                 ON cpd.user_id = $2 AND cpd.product_id = p.product_id
               WHERE p.product_id = $1
               FOR UPDATE OF p`,
              [id, req.user.user_id]
            )
          : await client.query(
              `SELECT name, price, has_discount, discount_percent
               FROM ${table} WHERE ${idColumn} = $1`,
              [id]
            );
      if (found.rows.length === 0) {
        throw Object.assign(new Error("Один из товаров или услуг больше недоступен"), { status: 400 });
      }
      if (item.type === "product") {
        const available = Number(found.rows[0].stock_quantity);
        if (quantity > available) {
          throw Object.assign(
            new Error(`На складе доступно только ${available} шт. товара «${found.rows[0].name}»`),
            { status: 400 }
          );
        }
      }

      const unitPrice = finalPrice(found.rows[0]);
      const lineSubtotal = unitPrice * quantity;
      lines.push({
        type: item.type,
        id,
        quantity,
        unitPrice,
        lineSubtotal,
        lineTotal: lineSubtotal,
        name: found.rows[0].name,
      });
    }

    const subtotal = lines.reduce((sum, line) => sum + line.lineSubtotal, 0);
    const requestedCode = typeof coupon_code === "string" ? coupon_code.trim().toUpperCase() : "";
    let couponId = null;
    let appliedCouponCode = null;
    let couponPercent = 0;
    if (requestedCode) {
      const couponResult = await client.query(
        `SELECT c.coupon_id, c.code, c.percent, c.usage_type, c.is_active, c.expires_at,
                c.min_order::float8 AS min_order,
                EXISTS (
                  SELECT 1 FROM coupon_assignments a WHERE a.coupon_id = c.coupon_id
                ) AS is_restricted,
                EXISTS (
                  SELECT 1 FROM coupon_assignments a
                  WHERE a.coupon_id = c.coupon_id AND a.user_id = $2
                ) AS is_assigned
         FROM coupons c
         WHERE upper(c.code) = $1
         FOR UPDATE OF c`,
        [requestedCode, req.user.user_id]
      );
      const coupon = couponResult.rows[0];
      if (!coupon) {
        throw Object.assign(new Error("Купон не найден или отключён"), { status: 400 });
      }
      if (coupon.is_restricted && !coupon.is_assigned) {
        throw Object.assign(new Error("Купон не назначен вашему аккаунту"), { status: 400 });
      }
      if (coupon.expires_at && new Date(coupon.expires_at) <= new Date()) {
        throw Object.assign(new Error("Срок действия купона истёк"), { status: 400 });
      }
      if (coupon.usage_type === "one_time") {
        const redemption = coupon.is_restricted
          ? await client.query(
              "SELECT 1 FROM coupon_redemptions WHERE coupon_id = $1 AND user_id = $2 LIMIT 1",
              [coupon.coupon_id, req.user.user_id]
            )
          : await client.query(
              "SELECT 1 FROM coupon_redemptions WHERE coupon_id = $1 LIMIT 1",
              [coupon.coupon_id]
            );
        if (redemption.rows.length > 0) {
              throw Object.assign(
                new Error("Одноразовый купон исчерпан: он уже использован"),
                { status: 400 }
              );
        }
      }
      if (!coupon.is_active) {
            throw Object.assign(new Error("Купон отключён"), { status: 400 });
      }
      if (subtotal < Number(coupon.min_order)) {
            throw Object.assign(
              new Error(`Минимальная сумма заказа для купона — ${coupon.min_order} ₽`),
              { status: 400 }
            );
      }
      couponId = coupon.coupon_id;
      appliedCouponCode = coupon.code;
      couponPercent = Number(coupon.percent);
      for (const line of lines) {
        line.lineTotal = Math.round(line.lineSubtotal * (1 - couponPercent / 100));
      }
    }
    const total = lines.reduce((sum, line) => sum + line.lineTotal, 0);
    const couponDiscountAmount = subtotal - total;

    const orderNumberResult = await client.query(
      `UPDATE users
       SET last_order_number = last_order_number + 1
       WHERE user_id = $1
       RETURNING last_order_number`,
      [req.user.user_id]
    );
    if (orderNumberResult.rows.length === 0) {
      throw Object.assign(new Error("Не удалось присвоить номер заказа"), { status: 500 });
    }
    const userOrderNumber = orderNumberResult.rows[0].last_order_number;

    const productLines = lines.filter((l) => l.type === "product");
    const serviceLines = lines.filter((l) => l.type === "service");
    let orderId = null;
    const appointmentIds = [];

    if (productLines.length > 0) {
      const orderTotal = productLines.reduce((sum, l) => sum + l.lineTotal, 0);
      const order = await client.query(
        `INSERT INTO orders (
           user_id, total, delivery_address, delivery_date, coupon_code,
           coupon_percent, coupon_discount_amount, user_order_number
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING order_id`,
        [
          req.user.user_id,
          orderTotal,
          address,
          delivery_date,
          appliedCouponCode,
          couponPercent,
          couponDiscountAmount,
          userOrderNumber,
        ]
      );
      orderId = order.rows[0].order_id;

      for (const l of productLines) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, quantity, unit_price)
           VALUES ($1, $2, $3, $4)`,
          [orderId, l.id, l.quantity, l.unitPrice]
        );
        await client.query(
          "UPDATE products SET stock_quantity = GREATEST(stock_quantity - $1, 0) WHERE product_id = $2",
          [l.quantity, l.id]
        );
      }

      await client.query(
        `INSERT INTO payments (user_id, order_id, amount, status, payment_method)
         VALUES ($1, $2, $3, 'pending', 'at_delivery')`,
        [req.user.user_id, orderId, orderTotal]
      );
    } else if (serviceLines.length > 0) {
      const order = await client.query(
        `INSERT INTO orders (
           user_id, total, delivery_address, delivery_date, coupon_code,
           coupon_percent, coupon_discount_amount, user_order_number
         )
         VALUES ($1, 0, $2, $3, $4, $5, $6, $7)
         RETURNING order_id`,
        [
          req.user.user_id,
          address,
          delivery_date,
          appliedCouponCode,
          couponPercent,
          couponDiscountAmount,
          userOrderNumber,
        ]
      );
      orderId = order.rows[0].order_id;
    }

    if (couponId) {
      await client.query(
        `INSERT INTO coupon_redemptions (coupon_id, user_id, order_id)
         VALUES ($1, $2, $3)`,
        [couponId, req.user.user_id, orderId]
      );
    }

    for (const l of serviceLines) {
      const appointment = await client.query(
        `INSERT INTO appointments (
           user_id, order_id, service_id, quantity, appointment_date, appointment_time, status, notes
         )
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIME, 'scheduled', $6)
         RETURNING appointment_id`,
        [
          req.user.user_id,
          orderId,
          l.id,
          l.quantity,
          delivery_date,
          `Доставка: ${address}; дата: ${delivery_date}`,
        ]
      );
      const appointmentId = appointment.rows[0].appointment_id;
      appointmentIds.push(appointmentId);

      await client.query(
        `INSERT INTO payments (user_id, appointment_id, amount, status, payment_method)
         VALUES ($1, $2, $3, 'pending', 'at_delivery')`,
        [req.user.user_id, appointmentId, l.lineTotal]
      );
    }

    await client.query("DELETE FROM cart_items WHERE user_id = $1", [req.user.user_id]);
    await client.query("COMMIT");

    res.status(201).json({
      message: "Заказ оформлен. Оплата — при получении товаров или оказании услуги.",
      total,
      order_id: orderId,
      user_order_number: userOrderNumber,
      coupon_code: appliedCouponCode,
      coupon_percent: couponPercent,
      coupon_discount_amount: couponDiscountAmount,
      appointment_ids: appointmentIds,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Ошибка оформления заказа: ", error);
    res
      .status(error.status || 500)
      .json({ message: error.status ? error.message : "Ошибка сервера при оформлении заказа" });
  } finally {
    client.release();
  }
});

// Возвращает историю заказов и записей текущего пользователя.
app.get("/api/my-orders", requireUser, async (req, res) => {
  try {
    const userId = req.user.user_id;

    const orders = await pool.query(
      `SELECT o.order_id, o.user_order_number, o.total::float8 AS total, o.status, o.created_at,
              pay.status AS payment_status, pay.payment_method,
              o.delivery_address, o.delivery_date::text AS delivery_date,
              o.coupon_code, o.coupon_percent,
              o.coupon_discount_amount::float8 AS coupon_discount_amount,
              COALESCE(json_agg(json_build_object(
                'name', p.name, 'quantity', oi.quantity, 'unit_price', oi.unit_price::float8,
                'image_url', p.image_url
              ) ORDER BY oi.item_id) FILTER (WHERE oi.item_id IS NOT NULL), '[]') AS items
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.order_id
       LEFT JOIN products p ON p.product_id = oi.product_id
       LEFT JOIN payments pay ON pay.order_id = o.order_id
       WHERE o.user_id = $1
       GROUP BY o.order_id, pay.status, pay.payment_method, o.coupon_code,
                o.coupon_percent, o.coupon_discount_amount, o.user_order_number
       ORDER BY o.order_id DESC`,
      [userId]
    );

    const appointments = await pool.query(
      `SELECT a.appointment_id, a.order_id, o.user_order_number, a.created_at,
              s.name AS service_name, s.image_url, s.category_id,
              s.price::float8 AS current_price, a.quantity,
              a.appointment_date::text AS appointment_date, to_char(a.appointment_time, 'HH24:MI') AS appointment_time, a.status,
              pay.amount::float8 AS amount, pay.status AS payment_status
       FROM appointments a
       LEFT JOIN orders o ON o.order_id = a.order_id
       JOIN services s ON s.service_id = a.service_id
       LEFT JOIN payments pay ON pay.appointment_id = a.appointment_id
       WHERE a.user_id = $1
       ORDER BY a.appointment_id DESC`,
      [userId]
    );

    const ordersWithServices = orders.rows.map((order) => ({ ...order, services: [] }));
    const ordersById = new Map(
      ordersWithServices.map((order) => [Number(order.order_id), order])
    );
    const ordersByCheckout = new Map(
      ordersWithServices.map((order) => [new Date(order.created_at).getTime(), order])
    );
    const standaloneAppointments = [];

    for (const appointment of appointments.rows) {
      const { created_at: createdAt, order_id: orderId, ...service } = appointment;
      const order = orderId
        ? ordersById.get(Number(orderId))
        : ordersByCheckout.get(new Date(createdAt).getTime());
      if (order) {
        order.services.push(service);
      } else {
        standaloneAppointments.push({ ...service, order_id: orderId });
      }
    }

    res.json({ orders: ordersWithServices, appointments: standaloneAppointments });
  } catch (error) {
    console.error("Ошибка запроса истории: ", error);
    res.status(500).json({ error: error.message });
  }
});

app.use((error, req, res, next) => {
  console.error("Необработанная ошибка API:", error);
  if (res.headersSent) return next(error);
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600
    ? error.status
    : 500;
  res.status(status).json({
    message: status === 400
      ? "Некорректные данные запроса"
      : "Внутренняя ошибка сервера. Проверьте доступность backend и базы данных.",
  });
});

// Подготавливает структуру базы данных и запускает сервер.
const startServer = async () => {
  try {
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(30)");
    await pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS users_phone_digits_unique
       ON users ((regexp_replace(phone, '[^0-9]', '', 'g')))
       WHERE phone IS NOT NULL AND btrim(phone) <> ''`
    );
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS default_address TEXT");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_order_number INTEGER NOT NULL DEFAULT 0");
    await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE");
    await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_address TEXT");
    await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_date DATE");
    await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(50)");
    await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_percent INTEGER");
    await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_discount_amount NUMERIC(12, 2) NOT NULL DEFAULT 0");
    await pool.query("ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_order_number INTEGER");
    await pool.query(
      `WITH numbered_orders AS (
         SELECT order_id,
                ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at, order_id)::integer AS number
         FROM orders
       )
       UPDATE orders o
       SET user_order_number = numbered_orders.number
       FROM numbered_orders
       WHERE o.order_id = numbered_orders.order_id AND o.user_order_number IS NULL`
    );
    await pool.query(
      `UPDATE users u
       SET last_order_number = GREATEST(
         u.last_order_number,
         COALESCE((SELECT MAX(o.user_order_number) FROM orders o WHERE o.user_id = u.user_id), 0)
       )`
    );
    await pool.query("ALTER TABLE orders ALTER COLUMN user_order_number SET NOT NULL");
    await pool.query(
      "CREATE UNIQUE INDEX IF NOT EXISTS orders_user_order_number_unique ON orders (user_id, user_order_number)"
    );
    await pool.query(
      "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS order_id INTEGER REFERENCES orders(order_id) ON DELETE SET NULL"
    );
    await pool.query(
      "CREATE INDEX IF NOT EXISTS appointments_order_id_idx ON appointments (order_id)"
    );
    const appointmentOrderClient = await pool.connect();
    let appointmentOrderTransactionStarted = false;
    try {
      await appointmentOrderClient.query("BEGIN");
      appointmentOrderTransactionStarted = true;
      await appointmentOrderClient.query(
        "LOCK TABLE users, orders, appointments IN SHARE ROW EXCLUSIVE MODE"
      );
      const unlinkedAppointments = await appointmentOrderClient.query(
        `SELECT appointment_id, user_id, created_at
         FROM appointments
         WHERE order_id IS NULL
         ORDER BY user_id, created_at, appointment_id
         FOR UPDATE`
      );
      for (const appointment of unlinkedAppointments.rows) {
        const orderNumber = await appointmentOrderClient.query(
          `UPDATE users
           SET last_order_number = last_order_number + 1
           WHERE user_id = $1
           RETURNING last_order_number`,
          [appointment.user_id]
        );
        if (orderNumber.rows.length === 0) {
          throw new Error(`Не найден пользователь записи ${appointment.appointment_id}`);
        }
        const order = await appointmentOrderClient.query(
          `INSERT INTO orders (user_id, total, user_order_number, created_at)
           VALUES ($1, 0, $2, $3)
           RETURNING order_id`,
          [appointment.user_id, orderNumber.rows[0].last_order_number, appointment.created_at]
        );
        await appointmentOrderClient.query(
          "UPDATE appointments SET order_id = $1 WHERE appointment_id = $2",
          [order.rows[0].order_id, appointment.appointment_id]
        );
      }
      await appointmentOrderClient.query("COMMIT");
      appointmentOrderTransactionStarted = false;
    } catch (error) {
      if (appointmentOrderTransactionStarted) {
        await appointmentOrderClient.query("ROLLBACK");
      }
      throw error;
    } finally {
      appointmentOrderClient.release();
    }
    await pool.query("ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_quantity INTEGER");
    await pool.query("UPDATE products SET stock_quantity = 100 WHERE stock_quantity IS NULL");
    await pool.query("ALTER TABLE products ALTER COLUMN stock_quantity SET DEFAULT 100");
    await pool.query("ALTER TABLE products ALTER COLUMN stock_quantity SET NOT NULL");
    await pool.query(
      `CREATE TABLE IF NOT EXISTS auth_sessions (
         token_hash CHAR(64) PRIMARY KEY,
         user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
         created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
         expires_at TIMESTAMPTZ NOT NULL
       )`
    );
    await pool.query("CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx ON auth_sessions (user_id)");
    await pool.query(
      `CREATE TABLE IF NOT EXISTS auth_sessions (
         token_hash CHAR(64) PRIMARY KEY,
         user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
         created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
         expires_at TIMESTAMPTZ NOT NULL
       )`
    );
    await pool.query("CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx ON auth_sessions (user_id)");
    await pool.query(
      "ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_method VARCHAR(30) NOT NULL DEFAULT 'at_delivery'"
    );
    await pool.query(
      "CREATE UNIQUE INDEX IF NOT EXISTS categories_name_casefold_unique ON categories (lower(btrim(name)))"
    );
    await pool.query(
      `INSERT INTO categories (name)
       SELECT 'Без категории'
       WHERE NOT EXISTS (
         SELECT 1 FROM categories WHERE lower(btrim(name)) = 'без категории'
       )`
    );
    await pool.query(
      `ALTER TABLE products
       DROP CONSTRAINT IF EXISTS products_stock_quantity_check,
       ADD CONSTRAINT products_stock_quantity_check
         CHECK (stock_quantity BETWEEN 0 AND 100000)`
    );
    await pool.query("UPDATE users SET discount_percent = 99 WHERE discount_percent > 99");
    await pool.query("UPDATE products SET discount_percent = 99 WHERE discount_percent > 99");
    await pool.query("UPDATE services SET discount_percent = 99 WHERE discount_percent > 99");
    await pool.query(
      `CREATE TABLE IF NOT EXISTS cart_items (
         cart_item_id SERIAL PRIMARY KEY,
         user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
         product_id INTEGER REFERENCES products(product_id) ON DELETE CASCADE,
         service_id INTEGER REFERENCES services(service_id) ON DELETE CASCADE,
         quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 100),
         CHECK ((product_id IS NOT NULL AND service_id IS NULL) OR
                (product_id IS NULL AND service_id IS NOT NULL))
       )`
    );
    await pool.query(
      `CREATE TABLE IF NOT EXISTS service_reviews (
         review_id SERIAL PRIMARY KEY,
         user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
         service_id INTEGER NOT NULL REFERENCES services(service_id) ON DELETE CASCADE,
         rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
         comment TEXT,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         is_removed BOOLEAN NOT NULL DEFAULT FALSE,
         UNIQUE (user_id, service_id)
       )`
    );
    await pool.query(
      "ALTER TABLE service_reviews ADD COLUMN IF NOT EXISTS is_removed BOOLEAN NOT NULL DEFAULT FALSE"
    );
    await pool.query(
      `CREATE TABLE IF NOT EXISTS product_reviews (
         review_id SERIAL PRIMARY KEY,
         user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
         product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
         order_id INTEGER REFERENCES orders(order_id) ON DELETE CASCADE,
         rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
         comment TEXT,
         created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
         is_removed BOOLEAN NOT NULL DEFAULT FALSE
       )`
    );
    await pool.query(
      "ALTER TABLE product_reviews ADD COLUMN IF NOT EXISTS is_removed BOOLEAN NOT NULL DEFAULT FALSE"
    );
    await pool.query(
      "ALTER TABLE product_reviews ADD COLUMN IF NOT EXISTS order_id INTEGER REFERENCES orders(order_id) ON DELETE CASCADE"
    );
    await pool.query(
      "ALTER TABLE product_reviews DROP CONSTRAINT IF EXISTS product_reviews_user_id_product_id_key"
    );
    await pool.query(
      `WITH legacy_reviews AS (
         SELECT rv.review_id,
                (
                  SELECT o.order_id
                  FROM orders o
                  JOIN order_items oi ON oi.order_id = o.order_id
                  WHERE o.user_id = rv.user_id
                    AND oi.product_id = rv.product_id
                    AND o.status = 'completed'
                    AND EXISTS (
                      SELECT 1
                      FROM payments pay
                      WHERE pay.order_id = o.order_id
                        AND pay.status = 'completed'
                    )
                    AND NOT EXISTS (
                      SELECT 1
                      FROM product_reviews existing
                      WHERE existing.order_id = o.order_id
                        AND existing.product_id = rv.product_id
                    )
                  ORDER BY o.created_at, o.order_id
                  LIMIT 1
                ) AS order_id
         FROM product_reviews rv
         WHERE rv.order_id IS NULL
       )
       UPDATE product_reviews rv
       SET order_id = legacy_reviews.order_id
       FROM legacy_reviews
       WHERE rv.review_id = legacy_reviews.review_id
         AND legacy_reviews.order_id IS NOT NULL`
    );
    await pool.query(
      "DROP INDEX IF EXISTS product_reviews_order_product_unique"
    );
    await pool.query(
      `WITH ranked_reviews AS (
         SELECT review_id,
                ROW_NUMBER() OVER (
                  PARTITION BY user_id, product_id
                  ORDER BY created_at, review_id
                ) AS position
         FROM product_reviews
       )
       DELETE FROM product_reviews rv
       USING ranked_reviews ranked
       WHERE rv.review_id = ranked.review_id
         AND ranked.position > 1`
    );
    await pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS product_reviews_user_product_unique
       ON product_reviews (user_id, product_id)`
    );
    await pool.query(
      `CREATE TABLE IF NOT EXISTS coupons (
         coupon_id SERIAL PRIMARY KEY,
         code VARCHAR(50) NOT NULL UNIQUE,
         percent INTEGER NOT NULL CHECK (percent BETWEEN 1 AND 99),
         usage_type VARCHAR(20) NOT NULL CHECK (usage_type IN ('one_time', 'multi_use')),
         is_active BOOLEAN NOT NULL DEFAULT TRUE,
         expires_at TIMESTAMPTZ,
         min_order NUMERIC(12, 2) NOT NULL DEFAULT 0 CHECK (min_order >= 0),
         created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
       )`
    );
    await pool.query(
      `DO $$
       BEGIN
         IF EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = current_schema()
             AND table_name = 'coupons'
             AND column_name = 'discount_percent'
         ) AND NOT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = current_schema()
             AND table_name = 'coupons'
             AND column_name = 'percent'
         ) THEN
           ALTER TABLE coupons RENAME COLUMN discount_percent TO percent;
         END IF;

         IF EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = current_schema()
             AND table_name = 'coupons'
             AND column_name = 'min_order_amount'
         ) AND NOT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = current_schema()
             AND table_name = 'coupons'
             AND column_name = 'min_order'
         ) THEN
           ALTER TABLE coupons RENAME COLUMN min_order_amount TO min_order;
         END IF;

         IF NOT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = current_schema()
             AND table_name = 'coupons'
             AND column_name = 'usage_type'
         ) THEN
           ALTER TABLE coupons ADD COLUMN usage_type VARCHAR(20);
           IF EXISTS (
             SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema()
               AND table_name = 'coupons'
               AND column_name = 'usage_limit'
           ) THEN
             UPDATE coupons
             SET usage_type = CASE WHEN usage_limit = 1 THEN 'one_time' ELSE 'multi_use' END;
           ELSE
             UPDATE coupons SET usage_type = 'multi_use';
           END IF;
           ALTER TABLE coupons
             ALTER COLUMN usage_type SET DEFAULT 'multi_use',
             ALTER COLUMN usage_type SET NOT NULL;
           ALTER TABLE coupons
             ADD CONSTRAINT coupons_usage_type_check
             CHECK (usage_type IN ('one_time', 'multi_use'));
         END IF;
       END $$`
    );
    await pool.query(
      `CREATE TABLE IF NOT EXISTS coupon_assignments (
         coupon_id INTEGER NOT NULL REFERENCES coupons(coupon_id) ON DELETE CASCADE,
         user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
         created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
         PRIMARY KEY (coupon_id, user_id)
       )`
    );
    await pool.query(
      `CREATE TABLE IF NOT EXISTS coupon_redemptions (
         redemption_id SERIAL PRIMARY KEY,
         coupon_id INTEGER NOT NULL REFERENCES coupons(coupon_id) ON DELETE RESTRICT,
         user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
         order_id INTEGER NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
         redeemed_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
         UNIQUE (coupon_id, user_id, order_id)
       )`
    );
    await pool.query(
      `CREATE TABLE IF NOT EXISTS password_reset_codes (
         user_id INTEGER PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
         code_hash TEXT NOT NULL,
         expires_at TIMESTAMPTZ NOT NULL,
         attempts SMALLINT NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
         created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
       )`
    );
    await pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS cart_items_user_product_unique
       ON cart_items (user_id, product_id) WHERE product_id IS NOT NULL`
    );
    await pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS cart_items_user_service_unique
       ON cart_items (user_id, service_id) WHERE service_id IS NOT NULL`
    );
    await pool.query(
      `CREATE TABLE IF NOT EXISTS client_product_discounts (
         user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
         product_id INTEGER NOT NULL REFERENCES products(product_id) ON DELETE CASCADE,
         discount_percent INTEGER NOT NULL CHECK (discount_percent BETWEEN 1 AND 99),
         PRIMARY KEY (user_id, product_id)
       )`
    );
    await pool.query("UPDATE client_product_discounts SET discount_percent = 99 WHERE discount_percent > 99");
    await pool.query(
      `ALTER TABLE client_product_discounts
       DROP CONSTRAINT IF EXISTS client_product_discounts_discount_percent_check,
       ADD CONSTRAINT client_product_discounts_discount_percent_check
         CHECK (discount_percent BETWEEN 1 AND 99)`
    );

    app.listen(PORT, () => {
      console.log(`Сервер запущен на http://localhost:${PORT}`);
      console.log(`1) Каталог услуг: http://localhost:${PORT}/api/services`);
      console.log(`2) Каталог товаров: http://localhost:${PORT}/api/products`);
      console.log(`3) Категории: http://localhost:${PORT}/api/categories`);
      console.log(`4) Тест БД: http://localhost:${PORT}/api/test-db`);
    });
  } catch (error) {
    console.error("Ошибка подготовки таблицы скидок для клиентов:", error);
    await pool.end();
    process.exitCode = 1;
  }
};

startServer();
