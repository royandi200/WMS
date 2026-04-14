/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        background:  '#0d1117',
        surface:     '#161b22',
        border:      '#30363d',
        muted:       '#8b949e',
        foreground:  '#e6edf3',
        subtle:      '#c9d1d9',
        primary:     '#f0883e',
        'primary-hover': '#d97e38',
        danger:      '#f85149',
      },
    },
  },
  plugins: [],
}
