DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS order_items CASCADE;
DROP TABLE IF EXISTS orders CASCADE;
DROP TABLE IF EXISTS appointments CASCADE;
DROP TABLE IF EXISTS products CASCADE;
DROP TABLE IF EXISTS services CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS roles CASCADE;

-- 1. Таблица ролей
CREATE TABLE roles (
    role_id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE
);

-- 2. Таблица пользователей
CREATE TABLE users (
    user_id SERIAL PRIMARY KEY,
    role_id INT NOT NULL REFERENCES roles(role_id) ON DELETE RESTRICT,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    discount_coupon VARCHAR(50),
    discount_percent INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Таблица категорий (общая для товаров и услуг)
CREATE TABLE categories (
    category_id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE
);

-- 4. Таблица товаров
CREATE TABLE products (
    product_id SERIAL PRIMARY KEY,
    category_id INT NOT NULL REFERENCES categories(category_id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    price NUMERIC(10, 2) NOT NULL,
    has_discount BOOLEAN DEFAULT FALSE,
    discount_percent INT DEFAULT 0,
    image_url TEXT
);

-- 5. Таблица услуг
CREATE TABLE services (
    service_id SERIAL PRIMARY KEY,
    category_id INT NOT NULL REFERENCES categories(category_id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    description TEXT,
    duration INT NOT NULL,
    price NUMERIC(10, 2) NOT NULL,
    has_discount BOOLEAN DEFAULT FALSE,
    discount_percent INT DEFAULT 0,
    image_url TEXT
);

-- 6. Таблица заказов товаров
CREATE TABLE orders (
    order_id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    total NUMERIC(10, 2) NOT NULL,
    status VARCHAR(20) DEFAULT 'new',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7. Состав заказа
CREATE TABLE order_items (
    item_id SERIAL PRIMARY KEY,
    order_id INT NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
    product_id INT NOT NULL REFERENCES products(product_id) ON DELETE RESTRICT,
    quantity INT NOT NULL DEFAULT 1,
    unit_price NUMERIC(10, 2) NOT NULL
);

-- 8. Таблица записей на услуги
CREATE TABLE appointments (
    appointment_id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    service_id INT NOT NULL REFERENCES services(service_id) ON DELETE CASCADE,
    quantity INT NOT NULL DEFAULT 1,
    appointment_date DATE NOT NULL,
    appointment_time TIME NOT NULL,
    status VARCHAR(20) DEFAULT 'scheduled',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 9. Таблица платежей (платёж относится либо к заказу, либо к записи)
CREATE TABLE payments (
    payment_id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    order_id INT REFERENCES orders(order_id) ON DELETE CASCADE,
    appointment_id INT REFERENCES appointments(appointment_id) ON DELETE CASCADE,
    amount NUMERIC(10, 2) NOT NULL,
    status VARCHAR(50) DEFAULT 'completed',
    payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CHECK (order_id IS NOT NULL OR appointment_id IS NOT NULL)
);

-- 10. Роли
INSERT INTO roles (name) VALUES
('admin'),
('client');

-- 11. Пользователи (пароль у всех: 123)
INSERT INTO users (role_id, name, email, password, discount_coupon, discount_percent) VALUES
(1, 'Велиев Джалал',     'jalal.veliev@forma.local',      '123', NULL,           0),
(2, 'Лабазанов Тимур',   'timur.labazanov@forma.local',   '123', 'GOLDENBOOT10', 10),
(2, 'Олейник Виктория',  'victoria.oleinik@forma.local',  '123', 'CHAMPION20',   20),
(2, 'Губогло Александр', 'alexander.guboglo@forma.local', '123', NULL,           0),
(2, 'Савенко Никита',    'nikita.savenko@forma.local',    '123', NULL,           0);

-- 12. Категории
INSERT INTO categories (name) VALUES
('Кастомизация формы'),
('Сервис бутс и шипов'),
('Вратарская экипировка'),
('Персональный подбор и VIP'),
('Футболки'),
('Лонгсливы');

-- 13. Товары
INSERT INTO products (category_id, name, description, price, has_discount, discount_percent, image_url) VALUES
(6, 'Лонгслив Suarez',    'Футбольный лонгслив с именем легендарного нападающего Луиса Суареса.', 7500.00, TRUE,  30, 'https://basket-32.wbbasket.ru/vol6724/part672443/672443552/images/c516x688/1.webp'),
(6, 'Лонгслив Shevchenko','Лонгслив в честь легенды украинского и европейского футбола.',         5000.00, FALSE, 0,  'https://basket-45.wbbasket.ru/vol12818/part1281809/1281809492/images/c516x688/1.webp'),
(5, 'Футболка F.Torres',  'Футболка для болельщиков Фернандо Торреса.',                           3000.00, FALSE, 0,  'https://basket-48.wbbasket.ru/vol15074/part1507430/1507430874/images/c516x688/1.webp'),
(6, 'Лонгслив L.Yamal',   'Удобный футбольный лонгслив с именем Ламина Ямаля на каждый день.',    2000.00, TRUE,  30, 'https://basket-37.wbbasket.ru/vol8011/part801171/801171027/images/c516x688/1.webp'),
(5, 'Футболка Pogba',     'Футболка для поклонников яркой игры Поля Погба.',                      2500.00, FALSE, 0,  'https://i.ebayimg.com/images/g/T98AAeSwY9towRnB/s-l1200.webp');

-- 14. Услуги
INSERT INTO services (category_id, name, description, duration, price, has_discount, discount_percent) VALUES
(1, 'Нанесение фамилии и номера (Шрифт РПЛ/Евро)', 'Термоперенос официального клубного шрифта на игровую футболку', 25, 1200.00, FALSE, 0),
(1, 'Установка патчей турниров (UEFA / РПЛ)', 'Приварка нарукавных шевронов Лиги Чемпионов или Чемпионата', 15, 800.00, TRUE, 15),
(1, 'Индивидуальный дизайн клубной нашивки', 'Разработка и нанесение уникального логотипа команды', 40, 2200.00, FALSE, 0),
(2, 'Термоформовка бутс под стопу', 'Разогрев в печи и анатомическая посадка обуви под стопу игрока', 35, 2500.00, FALSE, 0),
(2, 'Замена и смазка шипов (SG / гибриды)', 'Демонтаж старых шипов, чистка резьбы и установка комплекта шипов', 20, 950.00, TRUE, 20),
(2, 'Растяжка бутс в проблемных зонах', 'Механическая точечная коррекция ширины колодки', 30, 1400.00, FALSE, 0),
(3, 'Глубокая чистка и восстановление латекса перчаток', 'Бережное мытье спецсоставом и нанесение активатора сцепления', 45, 1900.00, FALSE, 0),
(3, 'Установка защитных пластин на пальцы (Spines)', 'Индивидуальный монтаж жестких суппортов в перчатки', 30, 1500.00, TRUE, 10),
(4, 'Бронирование VIP-примерочной с экипировщиком', 'Индивидуальный подбор комплекта формы на сезон с персональным менеджером', 60, 3000.00, FALSE, 0),
(4, 'Тестирование бутс на мини-газоне в шоуруме', 'Тест-драйв разных типов подошвы (FG, AG, TF) перед покупкой', 30, 1000.00, FALSE, 0);

-- 15. Примеры записей на услуги
INSERT INTO appointments (user_id, service_id, quantity, appointment_date, appointment_time, status, notes) VALUES
(2, 1, 1, '2026-10-05', '14:00:00', 'completed', 'Нанести номер 7 и Ronaldo'),
(2, 2, 1, '2026-10-10', '16:30:00', 'scheduled', 'Патч Лиги Чемпионов на рукав'),
(3, 4, 1, '2026-10-06', '12:00:00', 'scheduled', 'Формовка бутс');

-- 16. Пример заказа товаров
INSERT INTO orders (user_id, total, status) VALUES
(4, 3000.00, 'new');

INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES
(1, 3, 1, 3000.00);

-- 17. Платежи (с учётом купонов пользователей)
INSERT INTO payments (user_id, appointment_id, order_id, amount, status) VALUES
(2, 1,    NULL, 1080.00, 'completed'),
(2, 2,    NULL, 612.00,  'completed'),
(3, 3,    NULL, 2000.00, 'completed'),
(4, NULL, 1,    3000.00, 'completed');
