const profanityCharacterMap = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh',
  з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu',
  я: 'ya', 0: 'o', 1: 'i', 2: 'z', 3: 'e', 4: 'a', 5: 's', 6: 'g',
  7: 't', 8: 'b', 9: 'g', '!': 'i', '@': 'a', $: 's',
};

const latinKeyboardToRussian = {
  q: 'й', w: 'ц', e: 'у', r: 'к', t: 'е', y: 'н', u: 'г', i: 'ш', o: 'щ',
  p: 'з', a: 'ф', s: 'ы', d: 'в', f: 'а', g: 'п', h: 'р', j: 'о', k: 'л',
  l: 'д', z: 'я', x: 'ч', c: 'с', v: 'м', b: 'и', n: 'т', m: 'ь',
};

const prohibitedWords = [
  'blya', 'blyad', 'blyat', 'suka', 'cyka', 'cuka', 'pizd', 'hui', 'huy',
  'xui', 'xuy', 'huya', 'huye', 'hue', 'xue', 'mudak', 'gandon', 'ebat',
  'yob', 'pidor', 'daun', 'govno', 'dermo', 'mraz', 'sran', 'zalup', 'chmo',
  'her', 'xer', 'fuck', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'dick',
  'cock', 'slut', 'whore', 'fag',
];

// Приводит текст к виду, удобному для поиска запрещённых слов.
const normalizeProhibitedCandidate = (value) => String(value || '')
  .normalize('NFKD')
  .toLowerCase()
  .replace(/\p{M}/gu, '')
  .replace(/[\u200B-\u200F\uFEFF]/g, '')
  .replace(/[а-яё0-9!@$]/gu, (character) => profanityCharacterMap[character] ?? character)
  .split(/[^a-z]+/u)
  .filter(Boolean)
  .map((word) => word.replace(/(.)\1+/g, '$1'));

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
  const compact = words.join('');
  if (prohibitedWords.some((word) => compact.includes(word))) return true;
  return words.some((word) =>
    prohibitedWords.some((prohibitedWord) => containsNearProhibitedWord(word, prohibitedWord))
  );
};

// Проверяет текст на запрещённые слова и варианты с подменой символов.
export const containsProhibitedText = (value) => {
  const text = String(value || '');
  const keyboardVariant = text.replace(/[a-z]/gi, (character) =>
    latinKeyboardToRussian[character.toLowerCase()] || character
  );
  return hasProhibitedCandidate(text) || hasProhibitedCandidate(keyboardVariant);
};

const ignoredProhibitedTextFields = new Set([
  'password',
  'current_password',
  'new_password',
  'password_confirmation',
  'phone',
  'delivery_date',
  'appointment_date',
  'appointment_time',
  'expires_at',
  'type',
  'status',
  'payment_method',
]);

// Проверяет текстовые поля запроса, пропуская поля с нечеловеческими значениями.
export const containsProhibitedRequestText = (value, path = '', fieldName = '') => {
  if (typeof value === 'string') {
    const normalizedFieldName = fieldName.toLowerCase();
    if (
      ignoredProhibitedTextFields.has(normalizedFieldName) ||
      ((path === '/auth/reset-password' || path === '/api/auth/reset-password') &&
        normalizedFieldName === 'code')
    ) {
      return false;
    }
    return containsProhibitedText(value);
  }
  if (Array.isArray(value)) {
    return value.some((entry) => containsProhibitedRequestText(entry, path, fieldName));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, entry]) =>
      containsProhibitedRequestText(entry, path, key)
    );
  }
  return false;
};

// Проверяет структуру ФИО, включая составные части через дефис или апостроф.
export const isValidFullName = (value) => {
  const parts = String(value || '').normalize('NFKC').trim().split(/\s+/u);
  return parts.length >= 2 && parts.every((part) =>
    /^\p{L}{2,}(?:[-'’]\p{L}{2,})*$/u.test(part)
  );
};

// Проверяет формат телефонного номера и допустимое количество цифр.
export const isValidPhone = (value, { required = false } = {}) => {
  const phone = String(value || '').trim();
  if (!phone) return !required;
  if (!/^\+?\d[\d\s()-]*\d$/.test(phone) || phone.includes('()')) return false;

  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return false;

  let depth = 0;
  for (const character of phone) {
    if (character === '(') {
      if (depth !== 0) return false;
      depth = 1;
    } else if (character === ')') {
      if (depth === 0) return false;
      depth = 0;
    }
  }
  return depth === 0;
};
