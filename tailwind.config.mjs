/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './app/**/*.{js,jsx}',
    './lib/**/*.{js,jsx}',
  ],
  safelist: [
    // SCAN ALL green glass
    'from-emerald-500/60', 'to-emerald-700/50', 'border-emerald-300/50',
    'shadow-emerald-500/30', 'hover:from-emerald-500/75', 'hover:to-emerald-700/65',
    // Premier League — purple
    'from-purple-500/60', 'to-purple-800/50', 'border-purple-300/50',
    'shadow-purple-500/30', 'hover:from-purple-500/75', 'hover:to-purple-800/65',
    // Championship — red
    'from-red-600/60', 'to-red-900/50', 'border-red-400/50',
    'shadow-red-600/30', 'hover:from-red-600/75', 'hover:to-red-900/65',
    // Serie A — blue
    'from-blue-500/60', 'to-blue-800/50', 'border-blue-300/50',
    'shadow-blue-500/30', 'hover:from-blue-500/75', 'hover:to-blue-800/65',
    // La Liga — yellow
    'from-yellow-400/70', 'to-yellow-600/55', 'border-yellow-200/60',
    'shadow-yellow-400/30', 'hover:from-yellow-400/85', 'hover:to-yellow-600/70',
    // Toggle actives
    'from-emerald-400', 'to-emerald-600', 'shadow-emerald-500/40',
    'from-orange-400', 'to-red-600', 'shadow-orange-500/40',
  ],
  theme: { extend: {} },
  plugins: [],
};
