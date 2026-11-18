export type Language = 'ar' | 'en';
export type Direction = 'rtl' | 'ltr';

export type TranslationParams = Record<string, string | number>;

export interface LanguageContextValue {
  language: Language;
  direction: Direction;
  isRtl: boolean;
  setLanguage: (lang: Language) => void;
  toggleLanguage: () => void;
  t: (key: string, params?: TranslationParams) => string;
}

export type TranslationDictionary = {
  [key: string]: string | TranslationDictionary;
};
