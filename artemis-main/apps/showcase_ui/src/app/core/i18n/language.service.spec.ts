import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { LanguageService, LANGUAGE_STORAGE_KEY } from './language.service';
import { TranslatePipe } from './translate.pipe';

describe('UI language', () => {
  let storage: Map<string, string>;
  let documentStub: { documentElement: { lang: string }; defaultView: { localStorage: { getItem: jasmine.Spy; setItem: jasmine.Spy } } };

  beforeEach(() => {
    storage = new Map();
    documentStub = {
      documentElement: { lang: '' },
      defaultView: { localStorage: {
        getItem: jasmine.createSpy().and.callFake((key: string) => storage.get(key) ?? null),
        setItem: jasmine.createSpy().and.callFake((key: string, value: string) => storage.set(key, value))
      } }
    };
    TestBed.configureTestingModule({ providers: [{ provide: DOCUMENT, useValue: documentStub }] });
  });

  it('defaults to Chinese and switches an existing pipe without changing input text', () => {
    const service = TestBed.inject(LanguageService);
    const pipe = TestBed.runInInjectionContext(() => new TranslatePipe());
    expect(pipe.transform('Recommended Tasks')).toBe('推荐任务');
    service.setLanguage('en');
    expect(pipe.transform('Recommended Tasks')).toBe('Recommended Tasks');
    expect(documentStub.documentElement.lang).toBe('en');
    expect(storage.get(LANGUAGE_STORAGE_KEY)).toBe('en');
  });

  it('restores the saved English preference', () => {
    storage.set(LANGUAGE_STORAGE_KEY, 'en');
    expect(TestBed.inject(LanguageService).language()).toBe('en');
  });

  it('works when storage access is blocked', () => {
    documentStub.defaultView.localStorage.getItem.and.throwError('blocked');
    documentStub.defaultView.localStorage.setItem.and.throwError('blocked');
    const service = TestBed.inject(LanguageService);
    expect(service.language()).toBe('zh');
    expect(() => service.setLanguage('en')).not.toThrow();
    expect(service.translate('Workspace')).toBe('Workspace');
  });

  it('preserves unknown text, identifiers and English whitespace', () => {
    const service = TestBed.inject(LanguageService);
    expect(service.translate('855ef847 / gemini-3.8-flash')).toBe('855ef847 / gemini-3.8-flash');
    expect(service.translate('Custom server error: foo')).toBe('Custom server error: foo');
    expect(service.translate('Python 3.12.14 Ready')).toBe('Python 3.12.14 已就绪');
    expect(service.translate(' Workspace ')).toBe(' 工作区 ');
    service.setLanguage('en');
    expect(service.translate(' Workspace ')).toBe(' Workspace ');
  });
});
