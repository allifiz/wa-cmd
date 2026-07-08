const NOISY_LOG_PATTERNS = [
  'Closing open session in favor of incoming prekey bundle',
  'Closing session:',
  'SessionEntry {',
];

type ConsoleMethod = 'log' | 'info' | 'warn' | 'error' | 'debug';

function shouldHideLog(args: unknown[]): boolean {
  const first = args[0];
  if (typeof first !== 'string') return false;
  return NOISY_LOG_PATTERNS.some((pattern) => first.includes(pattern));
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
