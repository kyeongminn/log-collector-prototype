export type IconName = 'grid' | 'box' | 'logs' | 'search' | 'alert' | 'settings' | 'bell' | 'chevron' | 'refresh' | 'expand';

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, string> = {
    grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    box: 'm12 3 9 5v9l-9 5-9-5V8z M3 8l9 5 9-5 M12 13v9',
    logs: 'M6 3h12v18H6z M9 7h6 M9 11h6 M9 15h4',
    search: 'M20 20l-5-5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
    alert: 'm12 3 10 18H2z M12 9v5 M12 17v.5',
    settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',
    bell: 'M5 17h14l-2-3V9a5 5 0 0 0-10 0v5z M10 21h4',
    chevron: 'm9 5 7 7-7 7',
    refresh: 'M20 8a8 8 0 1 0 0 8 M20 3v5h-5',
    expand: 'M8 3H3v5 M16 3h5v5 M3 16v5h5 M21 16v5h-5',
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

export function Badge({ text }: { text: string }) {
  return <span className={`badge b-${text.toLowerCase().replace(/\s+/g, '-')}`}>{text}</span>;
}
