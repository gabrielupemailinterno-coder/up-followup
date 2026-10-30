/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './popup/**/*.{html,ts,tsx}',
    './kanban/**/*.{html,ts,tsx}',
    './content/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        wa: {
          green: '#25D366',
          'green-dark': '#128C7E',
          teal: '#075E54',
          'light-green': '#DCF8C6',
          bg: '#ECE5DD',
        },
      },
    },
  },
  plugins: [],
  // Prefix to avoid clashing with WhatsApp's own CSS classes
  prefix: 'wm-',
}
