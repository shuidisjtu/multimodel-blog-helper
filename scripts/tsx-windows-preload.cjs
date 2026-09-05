// Node 24 on some Windows hosts can fail in os.userInfo() with ENOMEM.
// tsx uses that value only to name its local IPC directory, so provide a
// stable non-sensitive fallback before tsx is loaded. run-tsx.mjs passes this
// preload through NODE_OPTIONS. Other platforms keep their native behavior.
if (process.platform === 'win32' && typeof process.geteuid !== 'function') {
  Object.defineProperty(process, 'geteuid', {
    configurable: true,
    value: () => 0,
  });
}
