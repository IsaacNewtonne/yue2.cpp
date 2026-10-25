// Older library entries cannot identify which generation stage hit its limit.
export function endingWarning(warning?: string): string {
	if (warning?.startsWith('Generation reached a composition or length limit before its natural ending.')) {
		return 'This take reached a composition or length limit and may be incomplete. Auto duration is still subject to model limits and a 10-minute maximum. Try shorter lyrics and a fresh composition.';
	}
	return warning ?? '';
}
