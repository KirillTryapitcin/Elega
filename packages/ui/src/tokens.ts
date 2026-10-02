/** The Dusk palette as data, for tests and non-CSS consumers. Must match theme.css. */
export const palette = {
  light: {
    bg: '#f4f4fa',
    surface: '#ffffff',
    ink: '#1b1b2e',
    muted: '#5e5f78',
    border: '#e2e2ef',
    primary: '#4338b8',
    onPrimary: '#ffffff',
    primarySoft: '#ebe9fb',
    primaryInk: '#3a2fa3',
    accent: '#f0715a',
    onAccent: '#2f0d06',
    accentSoft: '#fde6e1',
    accentInk: '#a8361f',
    danger: '#b42318',
    onDanger: '#ffffff',
  },
  dark: {
    bg: '#11111d',
    surface: '#1a1a2b',
    ink: '#e9e9f6',
    muted: '#a0a0bd',
    border: '#2a2a42',
    primary: '#8f8bf7',
    onPrimary: '#14123a',
    primarySoft: '#26244a',
    primaryInk: '#b9b6ff',
    accent: '#ff8a73',
    onAccent: '#2f0d06',
    accentSoft: '#3d1f1a',
    accentInk: '#ffb1a2',
    danger: '#ff8a80',
    onDanger: '#2d0605',
  },
} as const;

export type ThemeName = keyof typeof palette;
export type Token = keyof (typeof palette)['light'];

/** Foreground/background pairs the components actually use. */
export const textPairs: ReadonlyArray<readonly [Token, Token]> = [
  ['ink', 'bg'],
  ['ink', 'surface'],
  ['muted', 'bg'],
  ['muted', 'surface'],
  ['onPrimary', 'primary'],
  ['primaryInk', 'primarySoft'],
  ['primaryInk', 'surface'],
  ['onAccent', 'accent'],
  ['accentInk', 'accentSoft'],
  ['onDanger', 'danger'],
  ['danger', 'surface'],
];

function channel(hex: string, offset: number): number {
  const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

/** WCAG 2.1 contrast ratio between two #rrggbb colours. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
