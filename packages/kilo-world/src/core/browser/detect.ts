export const ANTI_DETECT = `
(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  const origQuery = window.navigator.permissions && window.navigator.permissions.query;
  if (origQuery) {
    window.navigator.permissions.query = (params) => {
      if (params && params.name === 'notifications') return Promise.resolve({ state: Notification.permission, onchange: null });
      return origQuery(params);
    };
  }
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'], configurable: true });
  const plugins = [
    { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    { name: 'Chrome PDF Viewer', filename: 'mhnbgjgfghfpdbnlgfkgmcbpfgjjdhhl', description: '' },
    { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' }
  ];
  Object.defineProperty(navigator, 'plugins', { get: () => plugins, configurable: true });
  const nativeChrome = window.chrome;
  const hasChrome = !!(nativeChrome && (nativeChrome.runtime || nativeChrome.csi));
  Object.defineProperty(window, 'chrome', { get: () => (hasChrome ? nativeChrome : { runtime: {}, csi: () => {}, loadTimes: () => ({}) }), configurable: true });
})();
`
