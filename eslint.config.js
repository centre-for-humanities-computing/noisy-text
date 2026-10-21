import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintPluginSvelte from 'eslint-plugin-svelte';
import svelteParser from 'svelte-eslint-parser';

export default tseslint.config(
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	...eslintPluginSvelte.configs['flat/recommended'],
	{
		languageOptions: {
			globals: {
				KeyboardEvent: 'readonly',
				MouseEvent: 'readonly',
				Event: 'readonly',
				WheelEvent: 'readonly',
				PointerEvent: 'readonly',
				HTMLElement: 'readonly',
				HTMLButtonElement: 'readonly',
				HTMLDivElement: 'readonly',
				HTMLCanvasElement: 'readonly',
				EventTarget: 'readonly',
				document: 'readonly',
				DOMRect: 'readonly',
				HTMLSelectElement: 'readonly',
				HTMLInputElement: 'readonly',
				window: 'readonly',
				performance: 'readonly',
				requestAnimationFrame: 'readonly',
				cancelAnimationFrame: 'readonly',
				ResizeObserver: 'readonly',
			},
		},
	},
	{
		rules: {
			'no-console': ['error', { allow: ['warn', 'error'] }],
			'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
		},
	},
	{
		files: ['**/*.svelte'],
		languageOptions: {
			parser: svelteParser,
			parserOptions: {
				parser: tseslint.parser,
			},
		},
	},
	{
		files: ['**/*.svelte.ts'],
		languageOptions: {
			parser: tseslint.parser,
		},
	},
	{
		files: ['scripts/**/*.mjs'],
		languageOptions: {
			globals: {
				console: 'readonly',
				process: 'readonly',
			},
		},
	},
	{
		ignores: [
			'build/',
			'.svelte-kit/',
			'dist/',
			'node_modules/',
			'test-results/',
			'playwright-report/',
			'.venv/',
			'.agents/',
			'.claude/',
		],
	},
);
