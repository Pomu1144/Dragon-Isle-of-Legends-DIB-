/** The loading screen is plain HTML in index.html, so it is up before any script has downloaded. */
const screen = () => document.getElementById('loading-screen');

export function loadingMessage(text: string) {
  const t = screen()?.querySelector('.ls-text');
  if (t) t.textContent = text;
}

/** Fade the loading screen out once the first scene is on screen. */
export function hideLoadingScreen() {
  const el = screen();
  if (!el) return;
  el.classList.add('done');
  setTimeout(() => el.remove(), 600);
}
