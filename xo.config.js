// Lint philosophy: prefer "boring", predictable code. Small functions, shallow
// nesting, low branching, explicit control flow, no clever one-liners. The
// complexity/size limits below are scoped to src/; test files relax them
// because describe/it callbacks legitimately nest and grow.
const readabilityRules = {
	complexity: ['error', 8],
	'max-depth': ['error', 3],
	'max-params': ['error', 4],
	'max-nested-callbacks': ['error', 3],
	'max-statements': ['error', 18],
	'max-lines-per-function': ['error', {max: 60, skipBlankLines: true, skipComments: true}],
	'no-else-return': ['error', {allowElseIf: false}],
	'no-lonely-if': 'error',
	'no-negated-condition': 'error',
	'no-param-reassign': 'error',
	'prefer-const': 'error',
	'@typescript-eslint/explicit-module-boundary-types': 'error',
	'@typescript-eslint/consistent-type-definitions': ['error', 'type'],
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
		rules: {
			...sharedRules,
			...readabilityRules,
		},
	},
	{
		files: ['test/**/*.ts'],
		rules: {
			'max-lines-per-function': 'off',
			'max-nested-callbacks': 'off',
			'max-statements': 'off',
			complexity: 'off',
		},
	},
];
