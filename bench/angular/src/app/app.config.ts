import {
  ApplicationConfig,
  InjectionToken,
  provideBrowserGlobalErrorListeners,
  provideZoneChangeDetection,
  provideZonelessChangeDetection,
} from '@angular/core';
import type { BenchConfig } from './config';

export const BENCH_CONFIG = new InjectionToken<BenchConfig>('BENCH_CONFIG');

export function createAppConfig(config: BenchConfig): ApplicationConfig {
  return {
    providers: [
      provideBrowserGlobalErrorListeners(),
      config.zone === 'zoneless' ? provideZonelessChangeDetection() : provideZoneChangeDetection(),
      { provide: BENCH_CONFIG, useValue: config },
    ],
  };
}
