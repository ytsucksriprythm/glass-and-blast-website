import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          50:  '#EEF2FF',
          100: '#E0E7FF',
          500: '#1E3A5F',
          600: '#162D4A',
          700: '#0F2035',
          800: '#0A1628',
          900: '#060D1A',
        },
        sky: {
          400: '#38BDF8',
          500: '#0EA5E9',
          600: '#0284C7',
        },
        // shadcn/ui tokens (mapped to the dark navy theme)
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['Geist', 'system-ui', 'sans-serif'],
        display: ['Archivo', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        // Layered, low-opacity shadows — soft depth without the default Tailwind look
        card: '0 1px 2px rgba(15,23,42,0.04), 0 8px 24px -8px rgba(15,23,42,0.10)',
        'card-lg': '0 2px 4px rgba(15,23,42,0.05), 0 24px 48px -16px rgba(15,23,42,0.18)',
      },
    },
  },
  plugins: [],
}
export default config
