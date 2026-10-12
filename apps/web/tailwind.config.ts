import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/** Token colours come from CSS variables in src/styles/globals.css (Figma variables). */
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Figma variables
        surface: {
          base: token('surface-base'),
          card: token('surface-card'),
          sunken: token('surface-sunken'),
        },
        ink: token('text-primary'),
        muted: {
          DEFAULT: token('text-muted'),
          foreground: token('text-muted'),
        },
        hairline: token('border-hairline'),
        strong: token('border-strong'),
        joy: {
          DEFAULT: token('heart-joy'),
          soft: token('heart-joy-soft'),
          badge: token('heart-joy-badge'),
          text: token('heart-joy-text-dark'),
        },
        care: {
          DEFAULT: token('heart-care'),
          soft: token('heart-care-soft'),
          text: token('heart-care-text-dark'),
        },
        media: {
          canvas: token('media-canvas'),
          text: token('media-text'),
        },
        // Status colours not in Figma (danger, success); chosen to pass WCAG AA.
        danger: {
          DEFAULT: token('status-danger'),
          soft: token('status-danger-soft'),
          text: token('status-danger-text'),
        },
        success: {
          DEFAULT: token('status-success'),
          soft: token('status-success-soft'),
          text: token('status-success-text'),
        },
        // shadcn/ui semantic names, mapped onto the tokens above
        background: token('surface-base'),
        foreground: token('text-primary'),
        border: token('border-hairline'),
        input: token('border-strong'),
        ring: token('focus-ring'),
        primary: { DEFAULT: token('heart-joy'), foreground: token('text-primary') },
        secondary: { DEFAULT: token('surface-sunken'), foreground: token('text-primary') },
        accent: { DEFAULT: token('surface-sunken'), foreground: token('text-primary') },
        destructive: { DEFAULT: token('status-danger'), foreground: token('surface-card') },
        popover: { DEFAULT: token('surface-card'), foreground: token('text-primary') },
        card: { DEFAULT: token('surface-card'), foreground: token('text-primary') },
      },
      fontFamily: {
        sans: ['Poppins', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        // Figma type scale (size, line height)
        '2xs': ['11px', '1.4'],
        xs: ['12px', '1.4'],
        '13': ['13px', '1.4'],
        sm: ['14px', '1.4'],
        base: ['16px', '1.4'],
        '17': ['17px', '1.4'],
        lg: ['18px', '1.4'],
        xl: ['22px', '1.4'],
        '2xl': ['28px', '1.2'],
        stat: ['30px', '1.1'],
      },
      letterSpacing: {
        kicker: '0.08em',
        group: '0.12em',
      },
      borderRadius: {
        card: '20px',
        tile: '12px',
        pill: '999px',
        lg: '12px',
        md: '8px',
        sm: '6px',
      },
      boxShadow: {
        popover: '0 12px 32px -8px rgb(26 23 20 / 0.18), 0 2px 6px rgb(26 23 20 / 0.06)',
      },
      width: {
        sidebar: '264px',
      },
      keyframes: {
        'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up': { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [animate],
};

export default config;
