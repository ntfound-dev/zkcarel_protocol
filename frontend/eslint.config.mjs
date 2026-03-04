import nextVitals from 'eslint-config-next/core-web-vitals'
import tsEslintPlugin from '@typescript-eslint/eslint-plugin'

const config = [
  ...nextVitals,
  ...tsEslintPlugin.configs['flat/recommended'],
  {
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'react/react-in-jsx-scope': 'off',
      'no-console': 'off',
      'prefer-const': 'off',
      '@next/next/no-img-element': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
    },
  },
]

export default config
