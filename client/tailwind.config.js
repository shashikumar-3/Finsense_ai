/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0b1120',
        panel: '#091611',
        panelSoft: '#102019',
        line: 'rgba(148, 163, 184, 0.18)',
        aqua: '#1ddf8f',
        sky: '#18b56d',
        violet: '#0f8b52',
        cyan: '#5bffbf',
        gold: '#fbbf24',
        rose: '#fb7185',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        sans: ['"Poppins"', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 30px 80px rgba(2, 6, 23, 0.52)',
        neon: '0 0 0 1px rgba(125, 211, 252, 0.12), 0 18px 50px rgba(37, 99, 235, 0.18), 0 8px 24px rgba(139, 92, 246, 0.14)',
        insetSoft: 'inset 0 1px 0 rgba(255,255,255,0.06)',
      },
      backgroundImage: {
        aurora:
          'radial-gradient(circle at top left, rgba(29,223,143,0.16), transparent 28%), radial-gradient(circle at top right, rgba(24,181,109,0.18), transparent 30%), radial-gradient(circle at 50% 20%, rgba(15,139,82,0.16), transparent 26%), linear-gradient(180deg, #07110d 0%, #0a1711 100%)',
        neon:
          'linear-gradient(135deg, rgba(18,199,119,0.95), rgba(15,168,101,0.92) 52%, rgba(68,240,167,0.95))',
      },
      animation: {
        float: 'float 8s ease-in-out infinite',
        pulseSoft: 'pulseSoft 5s ease-in-out infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: 0.7 },
          '50%': { opacity: 1 },
        },
      },
    },
  },
  plugins: [],
}
