import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";

export default tseslint.config(
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			globals: {
				...globals.browser,
				activeDocument: "readonly",
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.mts',
						'manifest.json',
					]
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json']
			},
		},
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
			'obsidianmd/ui/sentence-case': 'off',
		},
	},
	globalIgnores([
		"node_modules",
		"esbuild.config.mjs",
		"eslint.config.mts",
		"versions.json",
		"main.js",
		"tests",
	]),
);
