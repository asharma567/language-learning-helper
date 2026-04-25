/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx,md,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        phonetic: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'sans-serif',
        ],
      },
      colors: {
        navy: {
          900: '#0d1b2e',
          800: '#122240',
          700: '#1a3055',
        },
        accent: {
          DEFAULT: '#3b82f6',
        },
        card: {
          DEFAULT: '#ffffff',
          muted: '#f0f4f8',
        },
        text: {
          mute: '#94a3b8',
        },
        arc: {
          new: '#334155',
          progress: '#3b82f6',
          wrong: '#ef4444',
        },
      },
      backgroundImage: {
        'navy-gradient':
          'linear-gradient(180deg, #0d1b2e 0%, #122240 50%, #1a3055 100%)',
      },
    },
  },
  plugins: [],
};
