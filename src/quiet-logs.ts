const NOISY_LOG_PATTERNS = [
  'Closing open session in favor of incoming prekey bundle',
  'Closing session:',
  'SessionEntry {',
  'Failed to decrypt message with any known session',
  'Session error:Error: Bad MAC',
  'Error: Bad MAC',
  'at Object.verifyMAC',
  'at SessionCipher.doDecryptWhisperMessage',
  'at SessionCipher.decryptWithSessions',
  'as awaitable',
  'at async _asyncQueueExecutor',
];

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug';

function shouldHideLog(args: unknown[]): boolean {
  const text = args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return `${arg.name}: ${arg.message}\n${arg.stack ?? ''}`;
      return '';
    })
    .join(' ');

  if (!text) return false;
  return NOISY_LOG_PATTERNS.some((pattern) => text.includes(pattern));
}

function patchConsole(method: ConsoleMethod): void {
  const original = console[method].bind(console);

  console[method] = (...args: unknown[]) => {
    if (shouldHideLog(args)) return;
    original(...args);
  };
}

for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
  patchConsole(method);
}
