import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname
});

const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      '.worktrees/**',
      '.tmp/**',
      'next-env.d.ts',
      'public/sw.js',
      'public/workbox-*.js',
      'public/*.js'
    ]
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript')
];

export default config;
