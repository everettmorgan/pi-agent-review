const directiveCommentPattern = /^\s*(?:eslint|@ts-|globals?\s|exported\s)/v;
const dashPattern = /[–—]/v;
const affixUnderscorePattern = /^_|_$/v;

const selfDocumentingCode = {
	rules: {
		'no-dashes': {
			meta: {
				type: 'suggestion',
				docs: {description: 'Disallow em and en dashes in string content.'},
				messages: {noDashes: 'No em or en dashes in prompts or output strings; use colons, commas, or parentheses.'},
				schema: [],
			},
			create(context) {
				return {
					Literal(node) {
						if (typeof node.value === 'string' && dashPattern.test(node.value)) {
							context.report({node, messageId: 'noDashes'});
						}
					},
					TemplateElement(node) {
						if (dashPattern.test(node.value.raw)) {
							context.report({node, messageId: 'noDashes'});
						}
					},
				};
			},
		},
		'no-affix-underscores': {
			meta: {
				type: 'suggestion',
				docs: {description: 'Disallow underscore prefixes and suffixes on identifiers.'},
				messages: {noAffix: 'No underscore prefixes or suffixes on identifiers; use a plain name.'},
				schema: [],
			},
			create(context) {
				return {
					Identifier(node) {
						if (affixUnderscorePattern.test(node.name)) {
							context.report({node, messageId: 'noAffix'});
						}
					},
				};
			},
		},
		'no-comments': {
			meta: {
				type: 'suggestion',
				docs: {description: 'Disallow comments; the code must document itself.'},
				messages: {noComments: 'Comments are not allowed; make the code self-documenting (extract a well-named function, constant, or type instead). Non-code rationale belongs in docs/.'},
				schema: [],
			},
			create(context) {
				return {
					Program() {
						for (const comment of context.sourceCode.getAllComments()) {
							if (!directiveCommentPattern.test(comment.value)) {
								context.report({loc: comment.loc, messageId: 'noComments'});
							}
						}
					},
				};
			},
		},
	},
};

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
		files: ['**/*.ts', '**/*.js'],
		plugins: {self: selfDocumentingCode},
		rules: {
			'self/no-comments': 'error',
			'self/no-dashes': 'error',
			'self/no-affix-underscores': 'error',
		},
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
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unsafe-assignment': 'off',
		},
	},
];
