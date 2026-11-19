import { en } from '@/lib/i18n/translations/en';
import { ar } from '@/lib/i18n/translations/ar';
import { translate } from '@/lib/i18n/translations';

function getLeafPaths(
  obj: Record<string, unknown>,
  prefix = '',
): Array<{ path: string; value: string }> {
  let results: Array<{ path: string; value: string }> = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      results = results.concat(
        getLeafPaths(value as Record<string, unknown>, fullPath),
      );
    } else {
      results.push({ path: fullPath, value: String(value) });
    }
  }
  return results;
}

describe('i18n translation symmetry and validity', () => {
  const enEntries = getLeafPaths(en);
  const arEntries = getLeafPaths(ar);

  const enMap = new Map(enEntries.map((e) => [e.path, e.value]));
  const arMap = new Map(arEntries.map((e) => [e.path, e.value]));

  it('has identical key paths in both English and Arabic dictionaries', () => {
    const missingInAr = enEntries
      .map((e) => e.path)
      .filter((p) => !arMap.has(p));
    const missingInEn = arEntries
      .map((e) => e.path)
      .filter((p) => !enMap.has(p));

    expect(missingInAr).toEqual([]);
    expect(missingInEn).toEqual([]);
    expect(enEntries.length).toBe(arEntries.length);
  });

  it('contains no empty translation strings', () => {
    for (const entry of enEntries) {
      expect(entry.value.trim().length).toBeGreaterThan(0);
    }
    for (const entry of arEntries) {
      expect(entry.value.trim().length).toBeGreaterThan(0);
    }
  });

  it('has matching parameter placeholders between en and ar for all keys', () => {
    const placeholderRegex = /\{([a-zA-Z0-9_]+)\}/g;
    const mismatches: string[] = [];

    for (const [key, enVal] of enMap) {
      const arVal = arMap.get(key) || '';
      const enParams = (enVal.match(placeholderRegex) || []).sort();
      const arParams = (arVal.match(placeholderRegex) || []).sort();

      if (enParams.join(',') !== arParams.join(',')) {
        mismatches.push(
          `${key}: EN has [${enParams.join(',')}] but AR has [${arParams.join(',')}]`,
        );
      }
    }

    expect(mismatches).toEqual([]);
  });

  it('translates all pipeline job error codes with human-friendly messages', () => {
    const expectedErrorCodes = [
      'NO_AUDIO_TRACK',
      'DURATION_EXCEEDED',
      'CORRUPT_MEDIA',
      'UNSUPPORTED_FORMAT',
      'STORAGE_ERROR',
      'INSUFFICIENT_DISK_SPACE',
      'TRANSCRIBE_FAILED',
      'RENDER_FAILED',
      'CANCELLED_BY_USER',
      'TIMEOUT',
      'RATE_LIMIT_EXCEEDED',
      'NETWORK_ERROR',
      'UNAUTHORIZED',
      'FORBIDDEN',
      'NOT_FOUND',
      'GENERIC_ERROR',
    ];

    for (const code of expectedErrorCodes) {
      expect(enMap.has(`errors.${code}`)).toBe(true);
      expect(arMap.has(`errors.${code}`)).toBe(true);
      expect(enMap.get(`errors.${code}`)!.length).toBeGreaterThan(5);
      expect(arMap.get(`errors.${code}`)!.length).toBeGreaterThan(5);
    }
  });

  it('interpolates parameters correctly via translate helper', () => {
    const resultEn = translate('en', 'workspace.clipsCount', { count: 5 });
    expect(resultEn).toBe('5 clips');

    const resultAr = translate('ar', 'workspace.clipsCount', { count: 5 });
    expect(resultAr).toBe('5 مقطع');
  });

  it('falls back gracefully to English or key name when translation is missing', () => {
    const fallback = translate('ar', 'non.existent.key');
    expect(fallback).toBe('non.existent.key');
  });
});
