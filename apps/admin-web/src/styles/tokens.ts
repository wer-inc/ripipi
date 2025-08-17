/**
 * デザイントークン定義
 * ブランドアイデンティティを反映した一貫性のあるUI構築のための変数管理
 */

// ブランドカラーパレット（Ripipi美容室向け）
export const colors = {
  // Primary - 洗練されたティールグリーン（美容室の清潔感と安らぎ）
  primary: {
    50: 'hsl(170, 60%, 97%)',
    100: 'hsl(170, 60%, 94%)',
    200: 'hsl(170, 60%, 86%)',
    300: 'hsl(170, 60%, 73%)',
    400: 'hsl(170, 60%, 56%)',
    500: 'hsl(170, 60%, 41%)', // メインカラー
    600: 'hsl(170, 60%, 33%)',
    700: 'hsl(170, 60%, 27%)',
    800: 'hsl(170, 60%, 22%)',
    900: 'hsl(170, 60%, 19%)',
    950: 'hsl(170, 60%, 10%)',
  },
  // Secondary - 温かみのあるピンクベージュ（女性的な優しさ）
  secondary: {
    50: 'hsl(20, 40%, 97%)',
    100: 'hsl(20, 40%, 94%)',
    200: 'hsl(20, 40%, 88%)',
    300: 'hsl(20, 40%, 77%)',
    400: 'hsl(20, 40%, 64%)',
    500: 'hsl(20, 40%, 50%)',
    600: 'hsl(20, 40%, 40%)',
    700: 'hsl(20, 40%, 33%)',
    800: 'hsl(20, 40%, 28%)',
    900: 'hsl(20, 40%, 24%)',
    950: 'hsl(20, 40%, 13%)',
  },
  // Accent - ゴールド（プレミアム感）
  accent: {
    50: 'hsl(45, 80%, 97%)',
    100: 'hsl(45, 80%, 93%)',
    200: 'hsl(45, 80%, 84%)',
    300: 'hsl(45, 80%, 73%)',
    400: 'hsl(45, 80%, 59%)',
    500: 'hsl(45, 80%, 47%)',
    600: 'hsl(45, 80%, 40%)',
    700: 'hsl(45, 80%, 33%)',
    800: 'hsl(45, 80%, 27%)',
    900: 'hsl(45, 80%, 23%)',
    950: 'hsl(45, 80%, 12%)',
  },
  // Semantic colors
  success: {
    light: 'hsl(142, 76%, 94%)',
    DEFAULT: 'hsl(142, 76%, 36%)',
    dark: 'hsl(142, 76%, 20%)',
  },
  warning: {
    light: 'hsl(45, 100%, 94%)',
    DEFAULT: 'hsl(45, 100%, 51%)',
    dark: 'hsl(45, 100%, 30%)',
  },
  error: {
    light: 'hsl(0, 86%, 94%)',
    DEFAULT: 'hsl(0, 86%, 59%)',
    dark: 'hsl(0, 86%, 30%)',
  },
  info: {
    light: 'hsl(210, 100%, 94%)',
    DEFAULT: 'hsl(210, 100%, 50%)',
    dark: 'hsl(210, 100%, 30%)',
  },
} as const;

// スペーシングシステム（8pxベース）
export const spacing = {
  xs: '0.25rem',   // 4px
  sm: '0.5rem',    // 8px
  md: '1rem',      // 16px
  lg: '1.5rem',    // 24px
  xl: '2rem',      // 32px
  '2xl': '3rem',   // 48px
  '3xl': '4rem',   // 64px
} as const;

// タイポグラフィ
export const typography = {
  fonts: {
    sans: 'system-ui, -apple-system, "Hiragino Sans", "Yu Gothic UI", "Segoe UI", "Meiryo", sans-serif',
    mono: 'ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace',
  },
  sizes: {
    xs: '0.75rem',     // 12px
    sm: '0.875rem',    // 14px
    base: '1rem',      // 16px
    lg: '1.125rem',    // 18px
    xl: '1.25rem',     // 20px
    '2xl': '1.5rem',   // 24px
    '3xl': '1.875rem', // 30px
    '4xl': '2.25rem',  // 36px
  },
  weights: {
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
  lineHeights: {
    tight: '1.25',
    normal: '1.5',
    relaxed: '1.75',
  },
} as const;

// ボーダー半径
export const borderRadius = {
  none: '0',
  sm: '0.25rem',    // 4px
  DEFAULT: '0.5rem', // 8px
  md: '0.75rem',    // 12px
  lg: '1rem',       // 16px
  xl: '1.5rem',     // 24px
  full: '9999px',
} as const;

// シャドウ（エレベーション）
export const shadows = {
  none: 'none',
  sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
  DEFAULT: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
  md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
  lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  xl: '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)',
  '2xl': '0 25px 50px -12px rgb(0 0 0 / 0.25)',
  inner: 'inset 0 2px 4px 0 rgb(0 0 0 / 0.05)',
} as const;

// アニメーション
export const animation = {
  durations: {
    fast: '150ms',
    normal: '250ms',
    slow: '350ms',
    slower: '500ms',
  },
  easings: {
    linear: 'linear',
    in: 'cubic-bezier(0.4, 0, 1, 1)',
    out: 'cubic-bezier(0, 0, 0.2, 1)',
    inOut: 'cubic-bezier(0.4, 0, 0.2, 1)',
    bounce: 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
  },
} as const;

// ブレイクポイント
export const breakpoints = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
} as const;

// z-index レイヤー
export const zIndex = {
  base: 0,
  dropdown: 1000,
  sticky: 1020,
  fixed: 1030,
  modalBackdrop: 1040,
  modal: 1050,
  popover: 1060,
  tooltip: 1070,
  toast: 1080,
} as const;

// CSS変数として出力する関数
export function getCSSVariables() {
  return `
    :root {
      /* Primary Colors */
      --color-primary-50: ${colors.primary[50]};
      --color-primary-100: ${colors.primary[100]};
      --color-primary-200: ${colors.primary[200]};
      --color-primary-300: ${colors.primary[300]};
      --color-primary-400: ${colors.primary[400]};
      --color-primary-500: ${colors.primary[500]};
      --color-primary-600: ${colors.primary[600]};
      --color-primary-700: ${colors.primary[700]};
      --color-primary-800: ${colors.primary[800]};
      --color-primary-900: ${colors.primary[900]};
      --color-primary-950: ${colors.primary[950]};
      
      /* Secondary Colors */
      --color-secondary-50: ${colors.secondary[50]};
      --color-secondary-100: ${colors.secondary[100]};
      --color-secondary-200: ${colors.secondary[200]};
      --color-secondary-300: ${colors.secondary[300]};
      --color-secondary-400: ${colors.secondary[400]};
      --color-secondary-500: ${colors.secondary[500]};
      --color-secondary-600: ${colors.secondary[600]};
      --color-secondary-700: ${colors.secondary[700]};
      --color-secondary-800: ${colors.secondary[800]};
      --color-secondary-900: ${colors.secondary[900]};
      --color-secondary-950: ${colors.secondary[950]};
      
      /* Semantic Colors */
      --color-success: ${colors.success.DEFAULT};
      --color-warning: ${colors.warning.DEFAULT};
      --color-error: ${colors.error.DEFAULT};
      --color-info: ${colors.info.DEFAULT};
      
      /* Animation */
      --duration-fast: ${animation.durations.fast};
      --duration-normal: ${animation.durations.normal};
      --duration-slow: ${animation.durations.slow};
      --easing-in-out: ${animation.easings.inOut};
    }
  `;
}