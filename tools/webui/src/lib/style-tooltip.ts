import type { MusicStyleProfile } from './style-profiles.js';

// Portal to body so the explanation is never clipped by the scrolling style grid.
export function styleTooltip(node: HTMLElement, initial: MusicStyleProfile) {
	let style = initial;
	let popup: HTMLDivElement | undefined;

	const id = `style-help-${crypto.randomUUID()}`;
	function hide() {

		popup?.remove(); popup = undefined;
		node.setAttribute('aria-expanded', 'false');
	}
	function position() {
		if (!popup) return;
		const box = node.getBoundingClientRect();
		const width = Math.min(360, window.innerWidth - 24);
		popup.style.width = `${width}px`;
		popup.style.maxHeight = `${Math.min(480, window.innerHeight - 32)}px`;
		const height = popup.getBoundingClientRect().height;
		const right = box.right + 12;
		const left = right + width <= window.innerWidth - 12 ? right : Math.max(12, box.left - width - 12);
		popup.style.left = `${Math.min(left, window.innerWidth - width - 12)}px`;
		popup.style.top = `${Math.max(12, Math.min(box.top, window.innerHeight - height - 12))}px`;
	}
	function show() {

		if (popup) return;
		popup = document.createElement('div');
		popup.className = 'style-explanation'; popup.id = id; popup.popover = 'manual'; popup.setAttribute('role', 'dialog'); popup.setAttribute('aria-label', `About ${style.name}`);
        popup.addEventListener('toggle', () => node.setAttribute('aria-expanded', String(!!popup?.matches(':popover-open'))));
        const close = document.createElement('button'); close.type = 'button'; close.className = 'style-explanation-close'; close.textContent = '×'; close.setAttribute('aria-label', 'Close style description'); close.addEventListener('click', () => { hide(); node.focus(); }); popup.append(close);
		function append(tag: string, text: string, className = '') {
			const el = document.createElement(tag); el.textContent = text; el.className = className; popup!.append(el);
		}
		append('h4', style.name);
		const tempo = style.profile.match(/^\*\*Typical tempo:\*\*\s*(.+)$/m)?.[1];
		append('p', [style.family, tempo].filter(Boolean).join(' · '), 'style-explanation-meta');
		const sections = new Map([...style.profile.matchAll(/^## (.+)\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)].map(match => [match[1].trim(), match[2].trim()]));
		const identity = sections.get('Core Identity');
		if (identity) append('p', identity, 'style-explanation-intro');
		for (const [key, label] of [['Rhythm & Drums', 'Rhythm & drums'], ['Bass & Low End', 'Bass'], ['Harmony, Melody & Sound Palette', 'Sounds & instruments'], ['Vocal / Rap Approach', 'Vocal delivery'], ['Mood & Energy', 'Mood & energy']]) {
			const value = sections.get(key);
			if (value) { append('strong', label); append('p', value); }
		}
		document.body.append(popup); popup.showPopover(); node.setAttribute('aria-expanded', 'true'); position();
	}
	function click() {
        if (popup?.matches(':popover-open')) { hide(); return; }
        hide(); window.dispatchEvent(new Event('yue2-style-info')); show();
    }
    node.setAttribute('aria-haspopup', 'dialog');
    node.setAttribute('aria-controls', id);
    node.setAttribute('aria-expanded', 'false');
    function outside(event: PointerEvent) { if (popup && event.target instanceof Node && !node.contains(event.target) && !popup.contains(event.target)) hide(); }
    function key(event: KeyboardEvent) { if (event.key === 'Escape' && popup) { hide(); node.focus(); } }
    node.addEventListener('click', click);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    window.addEventListener('yue2-navigation', hide);
    window.addEventListener('yue2-style-info', hide);
    window.addEventListener('resize', position); window.addEventListener('scroll', position, true);
	return {
		update(next: MusicStyleProfile) { style = next; },
		destroy() {
			hide(); node.removeEventListener('click', click);
            document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key);
            window.removeEventListener('yue2-style-info', hide);
            window.removeEventListener('yue2-navigation', hide);
            window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true);
            node.removeAttribute('aria-haspopup'); node.removeAttribute('aria-controls'); node.removeAttribute('aria-expanded');
		}
	};
}
