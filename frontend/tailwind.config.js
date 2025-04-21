/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "space-black": "#0f172a",
        "space-blue": "#1e3a8a",
        "star-white": "#f8fafc",
      },
      fontFamily: {
        mono: ["Space Mono", "monospace"],
        sans: ["Roboto", "sans-serif"],
      },
      animation: {
        orbit: "orbit 120s linear infinite",
      },
      keyframes: {
        orbit: {
          "0%": { transform: "rotate(0deg) translateX(150px) rotate(0deg)" },
          "100%": {
            transform: "rotate(360deg) translateX(150px) rotate(-360deg)",
          },
        },
      },
    },
  },
  plugins: [],
};
