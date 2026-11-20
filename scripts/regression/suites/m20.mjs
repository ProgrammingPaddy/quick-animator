// The key held to animate (D425, D431): Shift unless the preferences name Ctrl or Alt, never a key that types, and everything that asked for Shift follows it, the look ahead, the drag, the wheel's lengths, and the words that name the key. The preferences take one of the three, and say what else it does with the pointer.
const NL = String.fromCharCode(10)
const SCENE = ['box = Rect({', '  x: -200,', '  y: 0,', '  width: 200,', '  height: 120,', "  fill: '#4f8cff',", '})', ''].join(NL)

const HELP = `
// Every check begins the same: no recording and no review, the Preview view fitted on an empty scene, Select in hand, nothing selected, no snapping, nothing colliding, the playhead at the start, animations starting at the playhead, no chain, and the key as the check names it.
const start = async (hotkeys = {}) => { if (S().recording) { S().toggleRecording(); await tick(60) } if (S().recordReview) ops.settleRecording([]); S().setPrefsOpen(false); S().setRate(100); S().setPlaying(false); S().setPreviewView('preview'); S().setTool('select'); S().setTimelineTool('select'); S().setTransformMode('all'); S().setPick('object'); S().select([]); S().setPreviewSnap({ on: false, edges: false }); S().setCollide(false); S().setPush(false); S().setNotice(null); S().setPin('start'); S().setChain(false); S().setPrefs({ hotkeys }); await setSource(''); [...document.querySelectorAll('.preview-tools button')].find((b) => b.textContent.trim() === 'Fit')?.click(); await tick(150); await setSource(${JSON.stringify(SCENE)}); S().select([]); S().setTime(0); await tick(250) };
const host = () => document.querySelector('.preview');
const at = (wx, wy) => { const b = host().getBoundingClientRect(); const p = QA.getViewport().toPane(wx, wy); return { x: b.left + p.x, y: b.top + p.y } };
const hover = () => { const p = at(500, 300); pe(host(), 'pointermove', p.x, p.y, { buttons: 0 }) };
const pull = async (from, to, extra = {}) => { const a = at(from.x, from.y), b = at(to.x, to.y); pe(host(), 'pointerdown', a.x, a.y, extra); for (let i = 1; i <= 8; i++) { pe(host(), 'pointermove', a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8, extra); await tick(16) } await tick(60); pe(host(), 'pointerup', b.x, b.y, extra); await tick(200) };
const count = () => obj('box').actions.length;
const x = () => /x: (-?[0-9.]+)/.exec(decl('box'))?.[1] ?? null;
const last = () => { const a = obj('box').actions.at(-1); return a ? { verb: a.verb, start: a.start, end: a.end } : null };
`

export default {
  // Shift as it always was; then Alt, with Shift a plain key, and a drag with Alt an animation and no turn of the view; then a key that types, kept from before, which counts as Shift.
  KEY1: `${HELP}
const out = {};
await start();
hover(); key('keydown', 'Shift', { shiftKey: true }); await tick(80);
out.shift = { ahead: S().time };
await pull({ x: -200, y: 0 }, { x: 0, y: 0 }, { shiftKey: true });
key('keyup', 'Shift'); await tick(120);
Object.assign(out.shift, { actions: count(), back: S().time, last: last(), x: x() });

await start({ animate: ['Alt'] });
hover(); key('keydown', 'Shift', { shiftKey: true }); await tick(80);
out.alt = { shiftAhead: S().time };
await pull({ x: -200, y: 0 }, { x: -100, y: 0 }, { shiftKey: true });
key('keyup', 'Shift'); await tick(120);
Object.assign(out.alt, { shiftDrag: { actions: count(), x: x() } });
hover(); key('keydown', 'Alt', { altKey: true, code: 'AltLeft' }); await tick(80);
out.alt.ahead = S().time;
await pull({ x: -100, y: 0 }, { x: 100, y: 0 }, { altKey: true });
key('keyup', 'Alt', { code: 'AltLeft' }); await tick(120);
Object.assign(out.alt, { actions: count(), back: S().time, last: last(), x: x(), viewTurned: !QA.getViewport().straight });

await start({ animate: ['F'] });
hover(); key('keydown', 'f', { code: 'KeyF' }); await tick(80);
out.f = { ahead: S().time };
key('keyup', 'f', { code: 'KeyF' }); await tick(60);
hover(); key('keydown', 'Shift', { shiftKey: true }); await tick(80);
out.f.shiftAhead = S().time;
await pull({ x: -200, y: 0 }, { x: 0, y: 0 }, { shiftKey: true });
key('keyup', 'Shift'); await tick(120);
Object.assign(out.f, { actions: count(), back: S().time });
// The words that name the key follow it.
out.f.tips = [...document.querySelectorAll('button[title]')].map((b) => b.title).filter((t) => t.includes('animates')).slice(0, 2);
S().setPrefs({ hotkeys: { animate: ['Ctrl'] } }); await tick(80);
out.ctrlTips = [...document.querySelectorAll('button[title]')].map((b) => b.title).filter((t) => t.includes('animates')).slice(0, 1);
S().setPrefs({ hotkeys: {} }); await tick(80);
out.tipsBack = [...document.querySelectorAll('button[title]')].map((b) => b.title).filter((t) => t.includes('animates')).slice(0, 1);
out.error = S().error;
return out`,

  // The wheel's lengths go with the key: held, the wheel changes the selected animation's length, in the preview and over the timeline; Shift, no longer the key, does not.
  KEY2: `${HELP}
const out = {};
await start({ animate: ['Alt'] });
hover(); key('keydown', 'Alt', { altKey: true, code: 'AltLeft' }); await tick(80);
await pull({ x: -200, y: 0 }, { x: 0, y: 0 }, { altKey: true });
key('keyup', 'Alt', { code: 'AltLeft' }); await tick(120);
out.made = count();
S().selectAction('box', 0); await tick(120);
const span = () => { const a = obj('box').actions[0]; return a ? Math.round((a.end - a.start) * 1000) / 1000 : null };
const wheel = async (el, extra = {}) => { const r = el.getBoundingClientRect(); el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, deltaY: -100, ...extra })); await tick(120) };
out.length0 = span();
const zoom0 = QA.getViewport().zoom;
await wheel(host(), { shiftKey: true });
out.shiftWheel = { length: span(), viewZoomed: QA.getViewport().zoom !== zoom0 };
hover(); key('keydown', 'Alt', { altKey: true, code: 'AltLeft' }); await tick(80);
await wheel(host(), { altKey: true });
out.heldWheel = { length: span(), time: Math.round(S().time * 1000) / 1000 };
const grid = document.querySelector('.tl-grid');
await wheel(grid, { altKey: true });
out.heldWheelTimeline = { length: span(), found: !!grid };
key('keyup', 'Alt', { code: 'AltLeft' }); await tick(120);
out.after = { length: span(), time: S().time };
S().setPrefs({ hotkeys: {} }); await tick(60);
out.error = S().error;
return out`,

  // The preferences: the row takes Shift, Ctrl, or Alt, and no key that types; says what else the key does with the pointer; and goes back.
  KEY3: `${HELP}
const out = {};
await start();
S().setPrefsOpen(true); await tick(250);
[...document.querySelectorAll('.prefs-tabs button, .prefs-tabs [role=tab]')].find((b) => b.textContent.trim() === 'Hotkeys')?.click(); await tick(200);
const row = () => [...document.querySelectorAll('.hotkey-row')].find((r) => r.querySelector('.hotkey-label')?.textContent === 'Hold to animate');
const read = () => ({ keys: [...row().querySelectorAll('.hotkey-chip')].map((c) => c.textContent.trim()), also: row().querySelector('.hotkey-conflict')?.textContent ?? null, prefs: S().prefs.hotkeys?.animate ?? null });
const press = async (init) => { row().querySelector('.hotkey-chip').click(); await tick(120); row().querySelector('.hotkey-chip.recording')?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })); await tick(150) };
out.found = !!row();
out.fixedRowsGone = [...document.querySelectorAll('.hotkey-label')].map((l) => l.textContent).filter((t) => t === 'Shift' || t === 'Shift while dragging');
out.first = read();
out.tip = row().title.slice(0, 60);
await press({ key: 'Alt', code: 'AltLeft', altKey: true });
out.alt = read();
await press({ key: 'Control', code: 'ControlLeft', ctrlKey: true });
out.ctrl = read();
// A key that types is not taken: the row goes on waiting, and the key stays as it was.
await press({ key: 'g', code: 'KeyG' });
out.g = read();
row().querySelector('.hotkey-chip.recording')?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape', code: 'Escape' })); await tick(120);
out.afterEscape = read();
// No row is named after the key it is on.
const listed = [...document.querySelectorAll(".hotkey-row")].map((r) => ({ label: r.querySelector('.hotkey-label')?.textContent ?? '', keys: [...r.querySelectorAll('.hotkey-chip')].map((c) => c.textContent.trim()) }));
out.selfNamed = listed.filter((r) => r.keys.some((k) => k.toLowerCase() === r.label.toLowerCase() || r.label.toLowerCase().startsWith(k.toLowerCase() + ' '))).map((r) => r.label);
out.pointerRows = listed.filter((r) => r.keys.some((k) => /drag|click|wheel/i.test(k))).map((r) => r.label + ': ' + r.keys.join(', '));
[...row().querySelectorAll('button')].find((b) => b.textContent.trim() === 'Reset')?.click(); await tick(120);
out.reset = read();
S().setPrefsOpen(false); S().setPrefs({ hotkeys: {} }); await tick(80);
return out`,
}
