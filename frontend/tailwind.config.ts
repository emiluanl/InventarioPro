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
        // Paleta neutral DARK-FIRST (estilo Musk/Grok/X): los valores gray-*
        // están invertidos para que los componentes existentes (bg-gray-100,
        // text-gray-900, border-gray-200...) queden oscuros sin tocarlos uno
        // a uno. La escala va de fondo (bajo) a texto (alto).
        // =====================================================================
        gray: {
          50: '#0a0a0b', // fondo más claro dentro del tema (aún oscuro)
          100: '#141417', // superficie base (cards, inputs, selects)
          200: '#1c1c1f', // superficie elevada (hover, dropdowns)
          300: '#2a2a30', // borde por defecto (1px, sutil) / superficie hover
          400: '#33333a', // borde hover / separadores fuertes
          500: '#7a7a82', // texto terciario / metadatos (contraste ≥ 3:1)
          600: '#9b9ba3', // texto secundario
          700: '#b6b6bf', // texto secundario alto
          800: '#d6d6dd', // texto principal suave
          900: '#f5f5f7', // texto principal (casi blanco)
          950: '#ffffff', // textos que necesitan blanco puro
        },
        // Acento eléctrico: azul brillante estilo Starlink/#0A84FF (Apple).
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
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        // Radios generosos estilo Grok/X (píldoras en acciones, suaves en cajas).
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
