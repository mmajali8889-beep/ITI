export interface Icd10CatalogItem {
  code: string;
  description: string;
  descriptionAr: string;
}

// Frequently used ICD-10 diagnoses across the hospital's main clinical areas.
// Manual code entry remains available for codes outside this quick-search set.
export const icd10Catalog: Icd10CatalogItem[] = [
  { code: 'A09', description: 'Infectious gastroenteritis and colitis, unspecified', descriptionAr: 'التهاب المعدة والأمعاء والقولون المعدي غير المحدد' },
  { code: 'B34.9', description: 'Viral infection, unspecified', descriptionAr: 'عدوى فيروسية غير محددة' },
  { code: 'D64.9', description: 'Anemia, unspecified', descriptionAr: 'فقر الدم غير المحدد' },
  { code: 'E03.9', description: 'Hypothyroidism, unspecified', descriptionAr: 'قصور الغدة الدرقية غير المحدد' },
  { code: 'E11.9', description: 'Type 2 diabetes mellitus without complications', descriptionAr: 'داء السكري من النوع الثاني دون مضاعفات' },
  { code: 'E78.5', description: 'Hyperlipidemia, unspecified', descriptionAr: 'فرط شحميات الدم غير المحدد' },
  { code: 'F32.9', description: 'Depressive episode, unspecified', descriptionAr: 'نوبة اكتئاب غير محددة' },
  { code: 'G40.9', description: 'Epilepsy, unspecified', descriptionAr: 'الصرع غير المحدد' },
  { code: 'G43.9', description: 'Migraine, unspecified', descriptionAr: 'الصداع النصفي غير المحدد' },
  { code: 'H10.9', description: 'Conjunctivitis, unspecified', descriptionAr: 'التهاب الملتحمة غير المحدد' },
  { code: 'I10', description: 'Essential (primary) hypertension', descriptionAr: 'ارتفاع ضغط الدم الأساسي' },
  { code: 'I20.9', description: 'Angina pectoris, unspecified', descriptionAr: 'الذبحة الصدرية غير المحددة' },
  { code: 'I25.1', description: 'Atherosclerotic heart disease', descriptionAr: 'مرض القلب التصلبي العصيدي' },
  { code: 'I48.9', description: 'Atrial fibrillation and flutter, unspecified', descriptionAr: 'الرجفان والرفرفة الأذينية غير المحددة' },
  { code: 'I50.9', description: 'Heart failure, unspecified', descriptionAr: 'فشل القلب غير المحدد' },
  { code: 'J02.9', description: 'Acute pharyngitis, unspecified', descriptionAr: 'التهاب البلعوم الحاد غير المحدد' },
  { code: 'J06.9', description: 'Acute upper respiratory infection, unspecified', descriptionAr: 'عدوى الجهاز التنفسي العلوي الحادة غير المحددة' },
  { code: 'J18.9', description: 'Pneumonia, unspecified organism', descriptionAr: 'التهاب رئوي بكائن غير محدد' },
  { code: 'J45.9', description: 'Asthma, unspecified', descriptionAr: 'الربو غير المحدد' },
  { code: 'K21.9', description: 'Gastro-esophageal reflux disease without esophagitis', descriptionAr: 'الارتجاع المعدي المريئي دون التهاب المريء' },
  { code: 'K29.7', description: 'Gastritis, unspecified', descriptionAr: 'التهاب المعدة غير المحدد' },
  { code: 'K52.9', description: 'Noninfective gastroenteritis and colitis, unspecified', descriptionAr: 'التهاب المعدة والأمعاء والقولون غير المعدي غير المحدد' },
  { code: 'M17.9', description: 'Osteoarthritis of knee, unspecified', descriptionAr: 'خشونة مفصل الركبة غير المحددة' },
  { code: 'M54.5', description: 'Low back pain', descriptionAr: 'ألم أسفل الظهر' },
  { code: 'N39.0', description: 'Urinary tract infection, site not specified', descriptionAr: 'عدوى المسالك البولية غير محددة الموضع' },
  { code: 'R05', description: 'Cough', descriptionAr: 'السعال' },
  { code: 'R07.9', description: 'Chest pain, unspecified', descriptionAr: 'ألم الصدر غير المحدد' },
  { code: 'R10.9', description: 'Unspecified abdominal pain', descriptionAr: 'ألم البطن غير المحدد' },
  { code: 'R11', description: 'Nausea and vomiting', descriptionAr: 'الغثيان والقيء' },
  { code: 'R42', description: 'Dizziness and giddiness', descriptionAr: 'الدوخة والدوار' },
  { code: 'R50.9', description: 'Fever, unspecified', descriptionAr: 'حمى غير محددة' },
  { code: 'R51.9', description: 'Headache, unspecified', descriptionAr: 'الصداع غير المحدد' },
  { code: 'S93.4', description: 'Sprain of ankle', descriptionAr: 'التواء الكاحل' },
  { code: 'Z00.0', description: 'General medical examination', descriptionAr: 'فحص طبي عام' },
  { code: 'Z34.9', description: 'Supervision of normal pregnancy, unspecified', descriptionAr: 'متابعة حمل طبيعي غير محدد' },
];

