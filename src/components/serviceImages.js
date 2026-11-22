const SERVICE_CATEGORY_IMAGES = {
  1: 'https://images.unsplash.com/photo-1517466787929-bc90951d0974?auto=format&fit=crop&w=800&q=80',
  2: 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?auto=format&fit=crop&w=800&q=80',
  3: 'https://images.unsplash.com/photo-1574629810360-7efbbe195018?auto=format&fit=crop&w=800&q=80',
  4: 'https://images.unsplash.com/photo-1522778119026-d647f0596c20?auto=format&fit=crop&w=800&q=80',
};

const SERVICE_IMAGES = {
  'Нанесение фамилии и номера (Шрифт РПЛ/Евро)': 'https://62s.ru/pictures/2913.jpg',
  'Установка патчей турниров (UEFA / РПЛ)':
    'https://avatars.mds.yandex.net/i?id=436afd67ca571b1ab44ad2a237dd47b6_l-4407700-images-thumbs&n=13',
  'Индивидуальный дизайн клубной нашивки':
    'https://embright.ru/photos/catalog_photos/174_vmin.webp',
  'Термоформовка бутс под стопу':
    'https://cdn.sportmaster.ru/upload/content/mediahab/prod/efd028eb-7d52-4f16-9ec8-e2209e0b3de1.jpg',
  'Замена и смазка шипов (SG / гибриды)':
    'https://best-grip.ru/wp-content/uploads/2024/10/snimok-ekrana-2024-09-09-v-12.40.20-4.jpg',
  'Растяжка бутс в проблемных зонах':
    'https://www.wikihow.com/images/thumb/7/7c/Stretch-Football-Boots-Step-3.jpg/v4-460px-Stretch-Football-Boots-Step-3.jpg',
  'Глубокая чистка и восстановление латекса перчаток':
    'https://avatars.mds.yandex.net/i?id=a2e90ee9d0aba193d424939fca6fcb92_l-5714527-images-thumbs&n=13',
  'Установка защитных пластин на пальцы (Spines)':
    'https://avatars.mds.yandex.net/i?id=1645485f5f43cfc4bf123d79df3c921f_l-13197814-images-thumbs&n=13',
  'Бронирование VIP-примерочной с экипировщиком':
    'https://ru.avkgroup.at/shared/files/201904/123618_190725.jpg',
  'Тестирование бутс на мини-газоне в шоуруме':
    'https://avatars.mds.yandex.net/i?id=2f0a70415c29660cf8faca68d6ff18289a0cccd6-6873210-images-thumbs&n=13',
};

// Выбирает изображение услуги из её данных или стандартного набора.
export const getServiceImage = (service) =>
  service.image_url ||
  SERVICE_IMAGES[service.name] ||
  SERVICE_CATEGORY_IMAGES[service.category_id] ||
  SERVICE_CATEGORY_IMAGES[1];
