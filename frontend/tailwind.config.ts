import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // =====================================================================
        // Paleta neutral por TEMA: los valores gray-* son variables CSS
        // (--tw-gray-50 … 950) que se redefinen en globals.css según la clase
        // `.light` del <html>. Así los componentes existentes (bg-gray-100,
        // text-gray-900, border-gray-200…) se adaptan a oscuro/claro sin
        // tocarlos uno a uno. El sufijo /<alpha> funciona gracias a
        // `rgb(var(--…) / <alpha-value>)`.
        // =====================================================================
        gray: {
          50: 'rgb(var(--tw-gray-50) / <alpha-value>)',
          100: 'rgb(var(--tw-gray-100) / <alpha-value>)',
          200: 'rgb(var(--tw-gray-200) / <alpha-value>)',
          300: 'rgb(var(--tw-gray-300) / <alpha-value>)',
          400: 'rgb(var(--tw-gray-400) / <alpha-value>)',
          500: 'rgb(var(--tw-gray-500) / <alpha-value>)',
          600: 'rgb(var(--tw-gray-600) / <alpha-value>)',
          700: 'rgb(var(--tw-gray-700) / <alpha-value>)',
          800: 'rgb(var(--tw-gray-800) / <alpha-value>)',
          900: 'rgb(var(--tw-gray-900) / <alpha-value>)',
          950: 'rgb(var(--tw-gray-950) / <alpha-value>)',
        },
        // Acento eléctrico (azul brillante, único de la marca InventarioPro).
        // Escala monótona (50 = más claro, 900 = más oscuro), como Tailwind:
        //   texto/link  -> 300/400 (claros, sobre fondo oscuro)
        //   botones     -> 500 base, 400 hover (aclara), 600 active
        accent: {
          50: '#e8f2ff',
          100: '#cfe5ff',
          200: '#a3cbff',
          300: '#6db1ff',
          400: '#3b8dff',
          500: '#0a84ff', // eléctrico base
          600: '#0066d6',
          700: '#0052ab',
          800: '#003f82',
          900: '#002c5c',
        },
        // Colores de ESTADO por tokens semánticos (definidos en globals.css):
        // se usan con alpha (bg-success/10, text-error, border-warning/40…).
        success: 'rgb(var(--tw-success) / <alpha-value>)',
        warning: 'rgb(var(--tw-warning) / <alpha-value>)',
        error: 'rgb(var(--tw-error) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        // Radios: suaves en cajas (xl2), píldoras en acciones (pill).
        xl2: '1rem',
        pill: '9999px',
      },
      boxShadow: {
        // Glow sutil para hovers/estados activos (micro-interacción).
        glow: '0 0 0 1px rgba(10, 132, 255, 0.25), 0 0 20px rgba(10, 132, 255, 0.15)',
        'glow-sm': '0 0 12px rgba(10, 132, 255, 0.12)',
        card: '0 1px 0 rgba(255, 255, 255, 0.03) inset, 0 4px 24px rgba(0, 0, 0, 0.4)',
      },
      transitionDuration: {
        // Micro-interacciones ~150-200ms.
        150: '150ms',
        200: '200ms',
      },
    },
  },
  plugins: [],
};

export default config;
