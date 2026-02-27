import nextVitals from 'eslint-config-next/core-web-vitals'
import tsEslintPlugin from '@typescript-eslint/eslint-plugin'

const config = [
  ...nextVitals,
  ...tsEslintPlugin.configs['flat/recommended'],
  {
    rules: {
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      'react/react-in-jsx-scope': 'off',
      'no-console': 'warn',
      'prefer-const': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
    },
  },
]

export default config
