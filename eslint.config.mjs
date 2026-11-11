import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import hooks from 'eslint-plugin-react-hooks'
export default tseslint.config(
  { ignores: ['node_modules/**', 'out/**', 'release/**', 'coverage/**'] },
  js.configs.recommended,
  { files: ['tests/e2e/*.mjs'], languageOptions: { globals: { process: 'readonly', window: 'readonly', document: 'readonly', innerWidth: 'readonly', console: 'readonly' } } },
  { files: ['scripts/*'], languageOptions: { globals: { process: 'readonly', module: 'readonly', require: 'readonly' } }, rules: { '@typescript-eslint/no-require-imports': 'off' } },
  ...tseslint.configs.recommended,
  { files: ['scripts/*.cjs'], rules: { '@typescript-eslint/no-require-imports': 'off' } },
  { files: ['src/renderer/**/*.tsx'], plugins: { 'react-hooks': hooks }, rules: hooks.configs.recommended.rules }
)
