export function createBrowserStorage() {
  if (typeof window === 'undefined') {
    return undefined;
  }

  return {
    getItem: (key: string) => {
      try {
        return window.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    setItem: (key: string, value: string) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // Ignore storage quota or privacy errors.
      }
    },
    removeItem: (key: string) => {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // Ignore storage access errors.
      }
    },
  };
}
