/** @type {import('tailwindcss').Config} */

/*
 * Ayira's palette is drawn from Kenyan textile and bead traditions rather than
 * from a generic SaaS blue.
 *
 * `ayira` is the red of the Maasai shuka -- the single most recognisable
 * Kenyan colour, and warm rather than alarming at the 600-700 end where
 * buttons and links sit. `gold` is savanna ochre and is reserved for money.
 * `acacia` is for growth and confirmation. The neutrals are warmed towards
 * bone and charcoal so nothing on the page reads as cold grey beside them.
 *
 * `gray` is overridden deliberately. The codebase uses text-gray-500 and
 * border-gray-200 throughout, so warming the default ramp re-themes every
 * page that was never touched, instead of leaving a cool grey shell around a
 * warm accent.
 *
 * Contrast was checked for text pairs: ayira-600 on white is 5.6:1, white on
 * ayira-600 is 5.6:1, gray-500 on white is 4.9:1 -- all at or above WCAG AA
 * for body text.
 */

const bone = {
  50: '#faf8f5',
  100: '#f3efe9',
  200: '#e6dfd4',
  300: '#d2c8b8',
  400: '#a89c8a',
  500: '#776b5b',
  600: '#5c5245',
  700: '#443d33',
  800: '#2c2721',
  900: '#1c1814',
};

export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        // Plus Jakarta Sans reads as friendly without being informal, which
        // suits a platform aimed at young workers. Loaded in index.html.
        sans: ['"Plus Jakarta Sans"', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        // For headings, where a little more character carries the theme
        // without costing legibility.
        display: ['"Outfit"', '"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'Consolas', 'monospace'],
      },
      colors: {
        // Primary -- Maasai shuka red. Full 50-900 ramp so borders, hovers
        // and fills all resolve without a fallback.
        ayira: {
          50: '#fdf4f2',
          100: '#fbe6e1',
          200: '#f6ccc3',
          300: '#eda898',
          400: '#e07a63',
          500: '#d15539',
          600: '#b8402a',
          700: '#9a3222',
          800: '#7d2b20',
          900: '#68261e',
        },
        // Reserved for money: escrow amounts, payouts, balances. Savanna
        // ochre, kept distinct from the primary so "this is about payment"
        // reads at a glance.
        gold: {
          50: '#fdf8ed',
          100: '#faeecb',
          200: '#f4dca0',
          300: '#eac466',
          400: '#e0a73c',
          500: '#cf8f22',
          600: '#b2741a',
          700: '#8e5a17',
          800: '#754a18',
          900: '#623e18',
        },
        // Growth and confirmation. Acacia green, muted so it sits with the
        // earth tones instead of reading as a system success colour.
        acacia: {
          50: '#f4f7f1',
          100: '#e5ecdf',
          200: '#cbd9c1',
          300: '#a7bf99',
          400: '#7fa06d',
          500: '#5f8450',
          600: '#4a6a3e',
          700: '#3b5333',
          800: '#31432c',
          900: '#293826',
        },
        // Indigo from kikoy and kitenge cloth. Used sparingly, for the pattern
        // work and for contrast against the reds.
        indigo: {
          50: '#f2f4f8',
          100: '#e2e7f0',
          200: '#c6d0e1',
          300: '#9fb0cb',
          400: '#7289b0',
          500: '#546c96',
          600: '#42567b',
          700: '#374764',
          800: '#2f3c53',
          900: '#1f2838',
        },
        slate: bone,
        // Overridden on purpose -- see the note at the top of this file.
        gray: bone,
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(28 24 20 / 0.04), 0 1px 3px 0 rgb(28 24 20 / 0.06)',
        lift: '0 4px 12px -2px rgb(28 24 20 / 0.10), 0 2px 6px -2px rgb(28 24 20 / 0.06)',
        pop: '0 12px 32px -8px rgb(28 24 20 / 0.18)',
        glow: '0 0 0 3px rgb(184 64 42 / 0.12)',
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.25rem',
      },
      keyframes: {
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(0.97)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        // For the woven strip that runs under the landing hero.
        weave: {
          from: { backgroundPosition: '0 0' },
          to: { backgroundPosition: '96px 0' },
        },
      },
      animation: {
        'slide-up': 'slide-up 160ms ease-out',
        'fade-in': 'fade-in 220ms ease-out',
        'scale-in': 'scale-in 160ms ease-out',
        weave: 'weave 24s linear infinite',
      },
      transitionTimingFunction: {
        // A slight overshoot, for things that appear rather than merely change.
        pop: 'cubic-bezier(0.34, 1.26, 0.64, 1)',
      },
    },
  },
  plugins: [],
};
