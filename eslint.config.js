import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import unicorn from 'eslint-plugin-unicorn';

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  unicorn.configs['recommended'],
  {
    ignores: ['dist/', 'docs/'],
  }
);
