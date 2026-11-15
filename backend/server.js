const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { Pool } = require("pg");

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
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

// ===== Вспомогательные функции =====

// Текущий пользователь определяется по заголовку x-user-id (его отправляет клиент после входа)
const getCurrentUser = async (req) => {
  const id = Number(req.headers["x-user-id"]);
  if (!Number.isInteger(id)) return null;
  const result = await pool.query(
    `SELECT u.user_id, u.name, u.email, u.discount_percent, r.name AS role
     FROM users u JOIN roles r ON u.role_id = r.role_id
     WHERE u.user_id = $1`,
    [id]
  );
  return result.rows[0] || null;
};

const requireUser = async (req, res, next) => {
  try {
    const user = await getCurrentUser(req);
    if (!user) {
      return res.status(401).json({ message: "Сначала войдите в систему" });
    }
    req.user = user;
    next();
  } catch (error) {
    console.error("Ошибка проверки пользователя:", error);
    res.status(500).json({ message: "Ошибка сервера" });
  }
};

const requireAdmin = (req, res, next) =>
  requireUser(req, res, () => {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Недостаточно прав" });
    }
    next();
  });

const finalPrice = (item) =>
  item.has_discount
    ? Math.round(Number(item.price) * (1 - item.discount_percent / 100))
    : Number(item.price);

// ===== Тест =====

app.get("/api/test", (req, res) => {
  res.json({ message: "API работает!", timestamp: new Date() });
});

app.get("/api/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS current_time");
    res.json({
      message: "Подключение к БД работает!",
      current_time: result.rows[0].current_time,
    });
  } catch (error) {
    console.error("Ошибка теста БД: ", error);
    res.status(500).json({ error: error.message });
  }
});

// ===== Каталог =====

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

app.get("/api/products", async (req, res) => {
  try {
    const query = `
      SELECT p.product_id, p.category_id, p.name, p.description,
             p.price::float8 AS price, p.has_discount, p.discount_percent,
             p.image_url, c.name AS category_name
      FROM products p
      JOIN categories c ON p.category_id = c.category_id
      ORDER BY p.product_id ASC
    `;
    const result = await pool.query(query);
    console.log(`Найдено товаров: ${result.rows.length}`);
    res.json(result.rows);
  } catch (error) {
    console.error("Ошибка запроса products:", error);
    res.status(500).json({ error: error.message });
  }
});

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

// ===== Авторизация =====

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Заполните email и пароль!" });
    }

    const result = await pool.query(
      `SELECT u.user_id, u.role_id, u.name, u.email, u.password, u.discount_coupon, u.discount_percent, r.name AS role
       FROM users u
       JOIN roles r ON u.role_id = r.role_id
       WHERE u.email = $1`,
      [email]
    );

    if (result.rows.length === 0 || result.rows[0].password !== password) {
      return res.status(401).json({ message: "Неверный email или пароль" });
    }

    const user = result.rows[0];
    delete user.password;
    res.json(user);
  } catch (error) {
    console.error("Ошибка при входе:", error);
    res.status(500).json({ message: "Ошибка сервера при авторизации" });
  }
});

// ===== Админ-действия =====

app.post("/api/categories", requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res
        .status(400)
        .json({ message: "Название категории не может быть пустым" });
    }

    const result = await pool.query(
      `INSERT INTO categories(name) VALUES ($1) RETURNING *`,
      [name.trim()]
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

app.get("/api/users", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.user_id, u.name, u.email, u.discount_coupon, u.discount_percent, r.name AS role
       FROM users u JOIN roles r ON u.role_id = r.role_id
       ORDER BY u.user_id ASC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Ошибка запроса users:", error);
    res.status(500).json({ error: error.message });
  }
});

app.patch("/api/users/discount", requireAdmin, async (req, res) => {
  try {
    const { email, discount_coupon, discount_percent } = req.body;
    const percent = Number(discount_percent) || 0;

    if (percent < 0 || percent > 90) {
      return res.status(400).json({ message: "Скидка должна быть от 0 до 90%" });
    }

    const result = await pool.query(
      `UPDATE users
       SET discount_coupon = $1, discount_percent = $2
       WHERE email = $3
       RETURNING user_id, email, discount_coupon, discount_percent`,
      [percent > 0 ? discount_coupon || null : null, percent, email]
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

const updateDiscount = (table, idColumn) => async (req, res) => {
  try {
    const { id } = req.params;
    const percent = Number(req.body.discount_percent) || 0;
    const hasDiscount = percent > 0;

    if (percent < 0 || percent > 90) {
      return res.status(400).json({ message: "Скидка должна быть от 0 до 90%" });
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

app.patch("/api/services/:id/discount", requireAdmin, updateDiscount("services", "service_id"));
app.patch("/api/products/:id/discount", requireAdmin, updateDiscount("products", "product_id"));

// ===== Оформление заказа =====
// body: { items: [{ type: "product" | "service", id, quantity }] }
// Цены считаются на сервере: скидка товара/услуги + персональный купон пользователя.
app.post("/api/checkout", requireUser, async (req, res) => {
  const { items } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ message: "Корзина пуста" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const couponPercent = Number(req.user.discount_percent) || 0;
    const lines = [];

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
      const found = await client.query(
        `SELECT name, price, has_discount, discount_percent FROM ${table} WHERE ${idColumn} = $1`,
        [id]
      );
      if (found.rows.length === 0) {
        throw Object.assign(new Error("Один из товаров или услуг больше недоступен"), { status: 400 });
      }

      const unitPrice = finalPrice(found.rows[0]);
      const lineTotal = Math.round(unitPrice * quantity * (1 - couponPercent / 100));
      lines.push({ type: item.type, id, quantity, unitPrice, lineTotal, name: found.rows[0].name });
    }

    const productLines = lines.filter((l) => l.type === "product");
    const serviceLines = lines.filter((l) => l.type === "service");
    let orderId = null;
    const appointmentIds = [];

    if (productLines.length > 0) {
      const orderTotal = productLines.reduce((sum, l) => sum + l.lineTotal, 0);
      const order = await client.query(
        `INSERT INTO orders (user_id, total) VALUES ($1, $2) RETURNING order_id`,
        [req.user.user_id, orderTotal]
      );
      orderId = order.rows[0].order_id;

      for (const l of productLines) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, quantity, unit_price)
           VALUES ($1, $2, $3, $4)`,
          [orderId, l.id, l.quantity, l.unitPrice]
        );
      }

      await client.query(
        `INSERT INTO payments (user_id, order_id, amount, status)
         VALUES ($1, $2, $3, 'completed')`,
        [req.user.user_id, orderId, orderTotal]
      );
    }

    for (const l of serviceLines) {
      const appointment = await client.query(
        `INSERT INTO appointments (user_id, service_id, quantity, appointment_date, appointment_time, status, notes)
         VALUES ($1, $2, $3, CURRENT_DATE, CURRENT_TIME, 'scheduled', $4)
         RETURNING appointment_id`,
        [req.user.user_id, l.id, l.quantity, "Заказ футбольной экипировки"]
      );
      const appointmentId = appointment.rows[0].appointment_id;
      appointmentIds.push(appointmentId);

      await client.query(
        `INSERT INTO payments (user_id, appointment_id, amount, status)
         VALUES ($1, $2, $3, 'completed')`,
        [req.user.user_id, appointmentId, l.lineTotal]
      );
    }

    await client.query("COMMIT");

    const total = lines.reduce((sum, l) => sum + l.lineTotal, 0);
    res.status(201).json({
      message: "Заказ успешно оформлен и оплачен!",
      total,
      order_id: orderId,
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

// ===== История пользователя =====

app.get("/api/my-orders", requireUser, async (req, res) => {
  try {
    const userId = req.user.user_id;

    const orders = await pool.query(
      `SELECT o.order_id, o.total::float8 AS total, o.status, o.created_at,
              COALESCE(json_agg(json_build_object(
                'name', p.name, 'quantity', oi.quantity, 'unit_price', oi.unit_price::float8
              ) ORDER BY oi.item_id) FILTER (WHERE oi.item_id IS NOT NULL), '[]') AS items
       FROM orders o
       LEFT JOIN order_items oi ON oi.order_id = o.order_id
       LEFT JOIN products p ON p.product_id = oi.product_id
       WHERE o.user_id = $1
       GROUP BY o.order_id
       ORDER BY o.order_id DESC`,
      [userId]
    );

    const appointments = await pool.query(
      `SELECT a.appointment_id, s.name AS service_name, a.quantity,
              a.appointment_date::text AS appointment_date, to_char(a.appointment_time, 'HH24:MI') AS appointment_time, a.status,
              pay.amount::float8 AS amount, pay.status AS payment_status
       FROM appointments a
       JOIN services s ON s.service_id = a.service_id
       LEFT JOIN payments pay ON pay.appointment_id = a.appointment_id
       WHERE a.user_id = $1
       ORDER BY a.appointment_id DESC`,
      [userId]
    );

    res.json({ orders: orders.rows, appointments: appointments.rows });
  } catch (error) {
    console.error("Ошибка запроса истории: ", error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Сервер запущен на http://localhost:${PORT}`);
  console.log(`1) Каталог услуг: http://localhost:${PORT}/api/services`);
  console.log(`2) Каталог товаров: http://localhost:${PORT}/api/products`);
  console.log(`3) Категории: http://localhost:${PORT}/api/categories`);
  console.log(`4) Тест БД: http://localhost:${PORT}/api/test-db`);
});
