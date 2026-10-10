import { DOCUMENT } from '@angular/common';
import { inject, Injectable, signal } from '@angular/core';
import { ZH_CN } from './zh-cn';

export type UiLanguage = 'zh' | 'en';
export const LANGUAGE_STORAGE_KEY = 'artemis.ui.language';

/** UI copy only: task text, model output and device identifiers stay untouched. */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly document = inject(DOCUMENT);
  private readonly current = signal<UiLanguage>(this.readPreference());
  readonly language = this.current.asReadonly();

  constructor() {
    this.updateDocument();
  }

  setLanguage(language: UiLanguage): void {
    this.current.set(language);
    this.updateDocument();
    try {
      this.document.defaultView?.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // The switch still works if the browser disallows persistent storage.
    }
  }

  translate(value: string | null | undefined): string {
    if (!value) return '';
    if (this.language() === 'en') return value;
    const key = value.replace(/\s+/g, ' ').trim();
    const translated = ZH_CN[key];
    if (translated === undefined) {
      // Known diagnostic templates preserve variable identifiers verbatim.
      return value
        .replace(/^Python ([\d.]+) Ready$/, 'Python $1 已就绪')
        .replace(/^Python ([\d.]+) Unsupported$/, 'Python $1 不受支持')
        .replace(/^(\d+) failed$/, '$1 项失败')
        .replace(/^Stop current task: /, '停止当前任务：')
        .replace(/^Stop current task \((.+)\)$/, '停止当前任务（$1）')
        .replace(/^ADB connected to (.+), but the Android lock screen is active\. Unlock the device and enter the home screen before running a task\.$/,
          'ADB 已连接到 $1，但设备处于锁屏状态。请解锁并进入主屏幕后再运行任务。')
        .replace(/^ADB connected to (.+), but Android lock-screen state could not be verified\. Keep the device unlocked on the home screen and check again\.$/,
          'ADB 已连接到 $1，但无法确认锁屏状态。请保持设备解锁并停留在主屏幕，然后再次检查。');
    }
    return value.match(/^\s*/)?.[0] + translated + value.match(/\s*$/)?.[0];
  }

  private readPreference(): UiLanguage {
    try {
      return this.document.defaultView?.localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'en' ? 'en' : 'zh';
    } catch {
      return 'zh';
    }
  }

  private updateDocument(): void {
    this.document.documentElement.lang = this.language() === 'zh' ? 'zh-CN' : 'en';
  }
}
