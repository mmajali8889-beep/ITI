const COMMON_NAMES: Record<string, string> = {
  'محمد': 'Mohammad',
  'محمود': 'Mahmoud',
  'أحمد': 'Ahmad',
  'احمد': 'Ahmad',
  'علي': 'Ali',
  'عمر': 'Omar',
  'يوسف': 'Yousef',
  'خالد': 'Khaled',
  'عبدالله': 'Abdullah',
  'عبد الله': 'Abdullah',
  'ابراهيم': 'Ibrahim',
  'إبراهيم': 'Ibrahim',
  'اسماعيل': 'Ismail',
  'إسماعيل': 'Ismail',
  'حسن': 'Hasan',
  'حسين': 'Hussein',
  'مصطفى': 'Mustafa',
  'فاطمة': 'Fatima',
  'مريم': 'Maryam',
  'سارة': 'Sara',
  'نور': 'Noor',
};

const DIGRAPHS: Array<[string, string]> = [
  ['ال', 'al'], ['تش', 'ch'], ['ش', 'sh'], ['ث', 'th'], ['خ', 'kh'],
  ['ذ', 'th'], ['غ', 'gh'], ['ظ', 'th'], ['ط', 't'], ['ض', 'd'],
];

const LETTERS: Record<string, string> = {
  ا: 'a', أ: 'a', إ: 'i', آ: 'aa', ء: '', ؤ: 'o', ئ: 'e',
  ب: 'b', ت: 't', ج: 'j', ح: 'h', د: 'd', ر: 'r', ز: 'z',
  س: 's', ص: 's', ع: 'a', ف: 'f', ق: 'q', ك: 'k', ل: 'l',
  م: 'm', ن: 'n', ه: 'h', و: 'o', ي: 'i', ى: 'a', ة: 'a',
  پ: 'p', ڤ: 'v', چ: 'ch', ژ: 'zh', گ: 'g',
};

export function transliterateArabicName(value: string): string {
  const normalized = value
    .trim()
    .replace(/[\u064B-\u065F\u0670]/g, '')
    .replace(/ـ/g, '')
    .replace(/\s+/g, ' ');

  if (!normalized) return '';
  const known = COMMON_NAMES[normalized];
  if (known) return known;

  const words = normalized.split(' ').map((word) => {
    const knownWord = COMMON_NAMES[word];
    if (knownWord) return knownWord;
    let remaining = word;
    let result = '';
    while (remaining) {
      const pair = DIGRAPHS.find(([arabic]) => remaining.startsWith(arabic));
      if (pair) {
        result += pair[1];
        remaining = remaining.slice(pair[0].length);
      } else {
        result += LETTERS[remaining[0]] ?? remaining[0];
        remaining = remaining.slice(1);
      }
    }
    return result ? result[0].toUpperCase() + result.slice(1) : '';
  });

  return words.join(' ');
}
