import { bootstrapApplication } from '@angular/platform-browser';
import { createAppConfig } from './app/app.config';
import { App } from './app/app';
import { readConfig } from './app/config';

const config = readConfig();
// zone.js is only loaded for the zone modes, so zoneless runs are not affected by its patches
if (config.zone !== 'zoneless') await import('zone.js');

bootstrapApplication(App, createAppConfig(config)).catch((err) => console.error(err));
