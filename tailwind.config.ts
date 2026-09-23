import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        limestone: '#E9ECE6',
        paper: '#F5F7F3',
        ink: '#12211C',
        muted: '#5C6B63',
        stone: '#C6CCC2',
        cactus: { DEFAULT: '#1E6B4B', deep: '#123D2C', pale: '#D7E5DC' },
        bloom: { DEFAULT: '#D6246E', pale: '#FBE4EE' },
        dust: '#B8A98D',
      },
      fontFamily: {
        display: ['var(--font-display)', 'ui-sans-serif', 'system-ui'],
        sans: ['var(--font-body)', 'ui-sans-serif', 'system-ui'],
      },
      fontSize: {
        // A deliberate scale rather than Tailwind's defaults: the question text
        // is the loudest thing on the onboarding screen and needs room.
        question: ['clamp(1.75rem, 1.2rem + 2.2vw, 2.85rem)', { lineHeight: '1.08', letterSpacing: '-0.022em' }],
        score: ['clamp(2.5rem, 2rem + 2vw, 3.5rem)', { lineHeight: '0.9', letterSpacing: '-0.03em' }],
      },
      maxWidth: { measure: '62ch' },
    },
  },
  plugins: [],
} satisfies Config;
