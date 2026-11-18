import { act, fireEvent, render, screen } from '@testing-library/react';
import { ClipThumbnail } from '@/components/videos/clip-render-controls';
import { LanguageProvider, useLanguage } from '@/lib/i18n/language-context';
import { translate, translations } from '@/lib/i18n/translations';
import { LanguageSwitcher } from '@/components/common/language-switcher';
import type { Clip, ClipRender } from '@/lib/api';

const mockClip: Clip = {
  id: 'clip-test-1',
  videoId: 'video-test-1',
  title: 'Challenger Test Clip',
  startSec: 15,
  endSec: 45,
  source: 'AI',
  createdAt: '2026-11-14T10:00:00.000Z',
  updatedAt: '2026-11-14T10:00:00.000Z',
  thumbnailUrl: null,
};

describe('Empirical Challenger: Multilingual i18n Stress Tests', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.lang = '';
    document.documentElement.dir = '';
    document.documentElement.className = '';
  });

  describe('1. Missing translation keys, malformed keys & prototype resilience', () => {
    it('returns the raw key when missing in both Arabic and English without throwing', () => {
      const missingKey = 'deeply.nested.nonexistent.key';
      expect(() => translate('ar', missingKey)).not.toThrow();
      expect(translate('ar', missingKey)).toBe(missingKey);
      expect(translate('en', missingKey)).toBe(missingKey);
    });

    it('falls back to English when a key exists in English', () => {
      const key = 'header.workspace';
      expect(translate('ar', key)).toBe(translations.ar.header.workspace);
      expect(translate('en', key)).toBe(translations.en.header.workspace);
    });

    it('handles parameter interpolation with missing parameters gracefully without crashing', () => {
      const template = 'workspace.runsOfLimit'; // "{runs} of {limit}"
      const res = translate('en', template, { runs: 5 });
      // {limit} remains unreplaced without crashing
      expect(res).toBe('5 of {limit}');
    });

    it('handles numeric parameters correctly in Arabic and English', () => {
      const resEn = translate('en', 'workspace.runsOfLimit', { runs: 3, limit: 10 });
      expect(resEn).toBe('3 of 10');
      const resAr = translate('ar', 'workspace.runsOfLimit', { runs: 3, limit: 10 });
      expect(resAr).toBe('3 من 10');
    });

    it('does not crash when traversing non-object primitives in dot-notation', () => {
      expect(() => translate('ar', 'header.workspace.child')).not.toThrow();
      expect(translate('ar', 'header.workspace.child')).toBe('header.workspace.child');
    });

    it('safely handles prototype pollution and constructor property access without leaking or crashing', () => {
      expect(() => translate('ar', '__proto__')).not.toThrow();
      expect(translate('ar', '__proto__')).toBe('__proto__');
      expect(() => translate('ar', 'constructor.prototype.toString')).not.toThrow();
      expect(translate('ar', 'constructor.prototype.toString')).toBe('constructor.prototype.toString');
    });

    it('handles empty string and malformed delimiter keys', () => {
      expect(translate('ar', '')).toBe('');
      expect(translate('ar', '....')).toBe('....');
    });
  });

  describe('2. LocalStorage corruption and invalid values', () => {
    function ConsumerComponent() {
      const { language, direction, isRtl, setLanguage, toggleLanguage, t } = useLanguage();
      return (
        <div>
          <span data-testid="lang">{language}</span>
          <span data-testid="dir">{direction}</span>
          <span data-testid="isRtl">{isRtl ? 'true' : 'false'}</span>
          <span data-testid="title">{t('header.workspace')}</span>
          <button data-testid="toggle-btn" onClick={toggleLanguage}>
            Toggle
          </button>
          <button data-testid="set-en-btn" onClick={() => setLanguage('en')}>
            Set EN
          </button>
          <button data-testid="set-ar-btn" onClick={() => setLanguage('ar')}>
            Set AR
          </button>
        </div>
      );
    }

    const corruptedValues = ['invalid_lang_xyz', 'fr', 'es', 'null', 'undefined', '123', ''];

    test.each(corruptedValues)(
      'safely falls back to default "ar" and "rtl" when localStorage is "%s"',
      (badVal) => {
        localStorage.setItem('reelcast_language', badVal);
        render(
          <LanguageProvider>
            <ConsumerComponent />
          </LanguageProvider>
        );

        expect(screen.getByTestId('lang')).toHaveTextContent('ar');
        expect(screen.getByTestId('dir')).toHaveTextContent('rtl');
        expect(screen.getByTestId('isRtl')).toHaveTextContent('true');
        expect(document.documentElement.dir).toBe('rtl');
        expect(document.documentElement.lang).toBe('ar');
      }
    );

    it('handles localStorage throwing exceptions (e.g. private browsing restrictions)', () => {
      const originalGetItem = localStorage.getItem;
      jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError: The operation is insecure.');
      });

      render(
        <LanguageProvider>
          <ConsumerComponent />
        </LanguageProvider>
      );

      expect(screen.getByTestId('lang')).toHaveTextContent('ar');
      expect(document.documentElement.dir).toBe('rtl');

      Storage.prototype.getItem = originalGetItem;
    });

    it('updates document.documentElement attributes and classes when toggling languages', () => {
      render(
        <LanguageProvider>
          <ConsumerComponent />
        </LanguageProvider>
      );

      // Initially AR
      expect(screen.getByTestId('lang')).toHaveTextContent('ar');
      expect(document.documentElement.dir).toBe('rtl');
      expect(document.documentElement.lang).toBe('ar');
      expect(document.documentElement.classList.contains('rtl')).toBe(true);
      expect(document.documentElement.classList.contains('ltr')).toBe(false);

      // Switch to EN
      fireEvent.click(screen.getByTestId('set-en-btn'));
      expect(screen.getByTestId('lang')).toHaveTextContent('en');
      expect(screen.getByTestId('dir')).toHaveTextContent('ltr');
      expect(screen.getByTestId('isRtl')).toHaveTextContent('false');
      expect(document.documentElement.dir).toBe('ltr');
      expect(document.documentElement.lang).toBe('en');
      expect(document.documentElement.classList.contains('ltr')).toBe(true);
      expect(document.documentElement.classList.contains('rtl')).toBe(false);
      expect(localStorage.getItem('reelcast_language')).toBe('en');

      // Toggle back to AR
      fireEvent.click(screen.getByTestId('toggle-btn'));
      expect(screen.getByTestId('lang')).toHaveTextContent('ar');
      expect(document.documentElement.dir).toBe('rtl');
      expect(document.documentElement.lang).toBe('ar');
      expect(localStorage.getItem('reelcast_language')).toBe('ar');
    });

    it('survives rapid language toggles and maintains DOM synchronization', () => {
      render(
        <LanguageProvider>
          <ConsumerComponent />
        </LanguageProvider>
      );

      const toggleBtn = screen.getByTestId('toggle-btn');
      for (let i = 0; i < 20; i++) {
        fireEvent.click(toggleBtn);
      }

      // After 20 toggles (even number), language should be 'ar'
      expect(screen.getByTestId('lang')).toHaveTextContent('ar');
      expect(document.documentElement.dir).toBe('rtl');
      expect(document.documentElement.lang).toBe('ar');
      expect(document.documentElement.classList.contains('rtl')).toBe(true);
    });

    it('synchronizes language across tabs via storage event', () => {
      render(
        <LanguageProvider defaultLang="ar">
          <ConsumerComponent />
        </LanguageProvider>
      );

      expect(screen.getByTestId('lang')).toHaveTextContent('ar');

      act(() => {
        window.dispatchEvent(
          new StorageEvent('storage', {
            key: 'reelcast_language',
            newValue: 'en',
          })
        );
      });

      expect(screen.getByTestId('lang')).toHaveTextContent('en');
      expect(document.documentElement.dir).toBe('ltr');
    });
  });

  describe('3. Isolated execution without LanguageProvider (Test Compatibility)', () => {
    function OrphanComponent() {
      const { language, direction, isRtl, setLanguage, toggleLanguage, t } = useLanguage();
      return (
        <div>
          <span data-testid="orphan-lang">{language}</span>
          <span data-testid="orphan-dir">{direction}</span>
          <span data-testid="orphan-isRtl">{isRtl ? 'true' : 'false'}</span>
          <span data-testid="orphan-text">{t('header.workspace')}</span>
          <button
            data-testid="orphan-btn"
            onClick={() => {
              setLanguage('ar');
              toggleLanguage();
            }}
          >
            Noop Action
          </button>
        </div>
      );
    }

    it('safely defaults to English and LTR without throwing any exceptions', () => {
      expect(() => render(<OrphanComponent />)).not.toThrow();

      expect(screen.getByTestId('orphan-lang')).toHaveTextContent('en');
      expect(screen.getByTestId('orphan-dir')).toHaveTextContent('ltr');
      expect(screen.getByTestId('orphan-isRtl')).toHaveTextContent('false');
      expect(screen.getByTestId('orphan-text')).toHaveTextContent('Workspace');

      // Calling setLanguage or toggleLanguage outside provider is a safe no-op
      expect(() => fireEvent.click(screen.getByTestId('orphan-btn'))).not.toThrow();
    });
  });

  describe('4. LanguageSwitcher component interactivity', () => {
    it('renders with appropriate accessibility attributes and toggles on click', () => {
      render(
        <LanguageProvider defaultLang="ar">
          <LanguageSwitcher />
        </LanguageProvider>
      );

      const btn = screen.getByRole('button', { name: /switch to english/i });
      expect(btn).toBeInTheDocument();
      expect(btn).toHaveTextContent('English');

      fireEvent.click(btn);

      // Now should switch to Arabic label
      expect(screen.getByRole('button', { name: /التحويل إلى العربية/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /التحويل إلى العربية/i })).toHaveTextContent('العربية');
    });
  });
});

describe('Empirical Challenger: ClipCard & ClipThumbnail Stress Tests', () => {
  const onPreview = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders dark fallback UI when thumbnail URL is null', () => {
    render(
      <ClipThumbnail
        aspect="9:16"
        busy={false}
        clip={{ ...mockClip, thumbnailUrl: null }}
        isPortrait={true}
        onPreview={onPreview}
        thumbnailUrl={null}
      />
    );

    // Fallback UI displays "Not rendered yet"
    expect(screen.getByText('Not rendered yet')).toBeInTheDocument();
    // Displays duration "30s" in both center card and corner badge
    const durationElements = screen.getAllByText('30s');
    expect(durationElements.length).toBeGreaterThanOrEqual(1);
    // No broken <img /> rendered
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('renders image when thumbnailUrl is provided, with loading state transitioning to loaded', () => {
    const { container } = render(
      <ClipThumbnail
        aspect="9:16"
        busy={false}
        clip={mockClip}
        isPortrait={true}
        onPreview={onPreview}
        thumbnailUrl="https://example.com/thumb.jpg"
      />
    );

    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute('src', 'https://example.com/thumb.jpg');
    // Initially opacity-0 before load
    expect(img).toHaveClass('opacity-0');

    // Simulate image load
    fireEvent.load(img!);
    expect(img).toHaveClass('opacity-100');
  });

  it('gracefully handles broken image load (onError) by rendering dark fallback UI without throwing', () => {
    const { container } = render(
      <ClipThumbnail
        aspect="9:16"
        busy={false}
        clip={{ ...mockClip, thumbnailUrl: 'https://broken-domain.test/404.jpg' }}
        isPortrait={true}
        onPreview={onPreview}
      />
    );

    const img = container.querySelector('img');
    expect(img).not.toBeNull();

    // Trigger onError
    expect(() => {
      fireEvent.error(img!);
    }).not.toThrow();

    // After error, fallback UI is displayed
    expect(screen.getByText('Not rendered yet')).toBeInTheDocument();
    const durationElements = screen.getAllByText('30s');
    expect(durationElements.length).toBeGreaterThanOrEqual(1);
    expect(container.querySelector('img')).toBeNull();
  });

  it('renders video player when clip render is completed with outputUrl', () => {
    const renderRecord: ClipRender = {
      id: 'render-comp-1',
      clipId: mockClip.id,
      status: 'COMPLETED',
      progress: 100,
      attempts: 1,
      error: null,
      startSec: 15,
      endSec: 45,
      outputUrl: 'https://example.com/reel.mp4',
      subtitles: true,
      subtitleStyle: null,
      createdAt: '2026-11-14T10:00:00.000Z',
      updatedAt: '2026-11-14T10:00:00.000Z',
    };

    const { container } = render(
      <ClipThumbnail
        aspect="9:16"
        busy={false}
        clip={mockClip}
        isPortrait={true}
        onPreview={onPreview}
        render={renderRecord}
        thumbnailUrl="https://example.com/thumb.jpg"
      />
    );

    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(video).toHaveAttribute('src', 'https://example.com/reel.mp4#t=0.5');
    // Image should not be shown when completed render video exists
    expect(container.querySelector('img')).toBeNull();
  });

  it('triggers onPreview callback on click', () => {
    render(
      <ClipThumbnail
        aspect="9:16"
        busy={false}
        clip={mockClip}
        isPortrait={true}
        onPreview={onPreview}
        thumbnailUrl="https://example.com/thumb.jpg"
      />
    );

    const btn = screen.getByRole('button', { name: /preview 9:16 reel/i });
    fireEvent.click(btn);
    expect(onPreview).toHaveBeenCalledWith('9:16');
  });
});
