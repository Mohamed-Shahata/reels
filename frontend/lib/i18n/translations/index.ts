import { ar } from './ar';
import { en } from './en';
import type { Language, TranslationParams } from '../types';

export const translations = {
  ar,
  en,
} as const;

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function translate(
  lang: Language,
  key: string,
  params?: TranslationParams
): string {
  const dict = translations[lang] || translations.en;
  let text = getNestedValue(dict as Record<string, unknown>, key);

  // Fallback to English dictionary if key is missing or not a string
  if (typeof text !== 'string') {
    text = getNestedValue(translations.en as Record<string, unknown>, key);
  }

  // Fallback to key itself if still not found
  if (typeof text !== 'string') {
    return key;
  }

  if (params && Object.keys(params).length > 0) {
    return Object.entries(params).reduce((acc, [paramKey, paramValue]) => {
      return acc.split(`{${paramKey}}`).join(String(paramValue));
    }, text);
  }

  return text;
}
