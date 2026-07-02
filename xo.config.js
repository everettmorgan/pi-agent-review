export default {
	rules: {
		'unicorn/prevent-abbreviations': 'off',
		'unicorn/no-null': 'off',
		'new-cap': ['error', {
			capIsNew: false,
			newIsCap: true,
			properties: true,
		}],
		'@eslint-community/eslint-comments/no-unlimited-disable': 'error',
		'@eslint-community/eslint-comments/disable-enable-pair': ['error', {allowWholeFile: true}],
	},
};
