// Lint philosophy: prefer "boring", predictable code. Small functions, shallow
// nesting, low branching, explicit control flow, no clever one-liners. The
// complexity/size limits below are scoped to src/; test files relax them
// because describe/it callbacks legitimately nest and grow.
const readabilityRules = {
	complexity: ['error', 10],
	'max-depth': ['error', 3],
	'max-params': ['error', 5],
	'max-nested-callbacks': ['error', 3],
	'max-statements': ['error', 25],
	'max-lines-per-function': ['error', {max: 60, skipBlankLines: true, skipComments: true}],
	'no-else-return': ['error', {allowElseIf: false}],
	'no-lonely-if': 'error',
	'no-negated-condition': 'error',
	'no-param-reassign': 'error',
	'prefer-const': 'error',
	'@typescript-eslint/explicit-module-boundary-types': 'error',
	'@typescript-eslint/consistent-type-definitions': ['error', 'type'],
};

// Type-aware safety rules: catch real bugs (unawaited promises, always-true
// conditions, unsafe assertions) while keeping idiomatic undefined.
const typeSafetyRules = {
	'@typescript-eslint/no-floating-promises': 'error',
	'@typescript-eslint/no-misused-promises': 'error',
	'@typescript-eslint/no-unnecessary-condition': 'error',
	'@typescript-eslint/strict-boolean-expressions': ['error', {allowNullableObject: false}],
	'@typescript-eslint/no-non-null-assertion': 'error',
	'@typescript-eslint/no-explicit-any': 'error',
	'@typescript-eslint/prefer-nullish-coalescing': 'error',
	'@typescript-eslint/prefer-optional-chain': 'error',
	'@typescript-eslint/switch-exhaustiveness-check': 'error',
};

const sharedRules = {
	'unicorn/prevent-abbreviations': 'off',
	'unicorn/no-null': 'off',
	'new-cap': ['error', {
		capIsNew: false,
		newIsCap: true,
		properties: true,
	}],
	'@eslint-community/eslint-comments/no-unlimited-disable': 'error',
	'@eslint-community/eslint-comments/disable-enable-pair': ['error', {allowWholeFile: true}],
};

export default [
	{
		ignores: ['**/*.md', 'docs/**', 'node_modules/**'],
	},
	{
		files: ['**/*.ts'],
		rules: {
			...sharedRules,
			...readabilityRules,
			...typeSafetyRules,
		},
	},
	{
		files: ['test/**/*.ts'],
		rules: {
			'max-lines-per-function': 'off',
			'max-nested-callbacks': 'off',
			'max-statements': 'off',
			complexity: 'off',
			// Tests use structural casts (as unknown as X) to build minimal fakes.
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unsafe-assignment': 'off',
		},
	},
];
