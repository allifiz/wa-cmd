#!/usr/bin/env node
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const notifierPkg = require('node-notifier');
const WindowsToaster = notifierPkg.WindowsToaster;
const notifier = process.platform === 'win32' && WindowsToaster
  ? new WindowsToaster({ withFallback: false })
  : notifierPkg;

try { process.stdout.write('\x07'); } catch {}

notifier.notify(
  {
    title: 'WA CMD Test',
    message: 'Kalau ini muncul, popup notification sudah aktif.',
    sound: true,
    wait: false,
    appID: 'WA CMD',
  },
  (err) => {
    if (err) {
      console.error('Notification error:', err.message ?? err);
      process.exitCode = 1;
      return;
    }
    console.log('Notification sent. Kalau popup tidak muncul, cek Windows Settings > System > Notifications dan Do Not Disturb.');
  },
);
