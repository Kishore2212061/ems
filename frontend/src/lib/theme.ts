import { useState } from 'react';

export type Theme = 'dark' | 'light';

// Initial class is applied by the inline script in index.html (before first paint → no flash).
export const currentTheme = (): Theme => (document.documentElement.classList.contains('dark') ? 'dark' : 'light');

export function useTheme() {
  const [theme, set] = useState<Theme>(currentTheme);
  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.classList.toggle('dark', next === 'dark');
    localStorage.setItem('theme', next);
    set(next);
  };
  return { theme, toggle };
}
