/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50:  '#f0fdf4',
          100: '#dcfce7',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
        },
        sport: {
          run:      '#f97316',
          cycle:    '#3b82f6',
          swim:     '#06b6d4',
          strength: '#8b5cf6',
          core:     '#ec4899',
          brick:    '#f59e0b',
        },
        zone: {
          1: '#86efac',
          2: '#4ade80',
          3: '#facc15',
          4: '#fb923c',
          5: '#f87171',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      }
    }
  },
  plugins: []
}
