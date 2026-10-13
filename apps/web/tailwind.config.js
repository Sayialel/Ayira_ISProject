/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Plus Jakarta Sans reads as friendly without being informal, which
        // suits a platform aimed at young workers. Loaded in index.html.
        sans: ['"Plus Jakarta Sans"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'Consolas', 'monospace'],
      },
      colors: {
        // Primary. Full 50–900 ramp so borders, hovers and fills all resolve.
        ayira: {
          50: '#f0f7ff',
          100: '#e0effe',
          200: '#bae0fd',
          300: '#7cc8fb',
          400: '#36acf7',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a5f',
        },
        // Neutrals carry a slight blue bias so they sit with the primary
        // rather than looking like a separate, colder system.
        slate: {
          50: '#f7f9fc',
          100: '#eef2f8',
          200: '#dfe5f0',
          300: '#c5cfe0',
          400: '#94a2bb',
          500: '#64748b',
          600: '#4a5771',
          700: '#36415a',
          800: '#232c42',
          900: '#141b2d',
        },
        // Reserved for money: escrow amounts, payouts, balances. Kept separate
        // from the primary so "this is about payment" reads at a glance.
        gold: {
          50: '#fffaeb',
          100: '#fef0c7',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
        },
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(20 27 45 / 0.04), 0 1px 3px 0 rgb(20 27 45 / 0.06)',
        lift: '0 4px 12px -2px rgb(20 27 45 / 0.10), 0 2px 6px -2px rgb(20 27 45 / 0.06)',
        pop: '0 12px 32px -8px rgb(20 27 45 / 0.18)',
      },
      borderRadius: {
        xl: '0.875rem',
      },
      keyframes: {
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'slide-up': 'slide-up 160ms ease-out',
      },
    },
  },
  plugins: [],
};
