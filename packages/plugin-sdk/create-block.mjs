/** A dependency-free, self-contained starter; richer UIs can use any bundler. */
export function blockStarterHTML(browserSource) {
  return `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Writing card</title>
<style>
*{box-sizing:border-box}body{margin:0;padding:24px;font:15px/1.6 system-ui;color:var(--fg,#252820);background:var(--bg,#fff)}
h2{font-size:20px;margin:0 0 8px}p{margin:0 0 16px;color:var(--muted,#73776c)}label{display:block;font-weight:600}
textarea{width:100%;min-height:150px;resize:vertical;margin:8px 0 16px;padding:12px;border:1px solid var(--border,#dadcd5);border-radius:8px;background:inherit;color:inherit;font:inherit}
button{border:1px solid var(--border,#dadcd5);background:var(--accent,#788765);color:white;border-radius:8px;padding:10px 16px;font:inherit;cursor:pointer}
button:disabled{opacity:.5}output{display:block;margin-top:16px;white-space:pre-wrap}.reading{white-space:pre-wrap}
</style>
<h2>Writing card</h2><p id="hint">A little space for your words.</p>
<section id="editor" hidden><label>Your words<textarea id="text" maxlength="12000"></textarea></label><button id="count" type="button">Count my words</button></section>
<div id="reading" class="reading"></div><output id="status" role="status"></output>
<script type="module">
${browserSource}
const client = await connectBlock();
const { mode, theme } = client.context;
for (const [key, token] of Object.entries({bg:'background',fg:'foreground',muted:'muted',border:'border',accent:'accent'})) {
  if (theme[token]) document.body.style.setProperty('--' + key, theme[token]);
}
let saved;
try { saved = JSON.parse(client.context.source); } catch { saved = { text: client.context.source }; }
const text = document.querySelector('#text');
const status = document.querySelector('#status');
text.value = typeof saved?.text === 'string' ? saved.text : '';
document.querySelector('#reading').textContent = mode === 'read' ? text.value : '';
document.querySelector('#editor').hidden = mode === 'read';
document.querySelector('#hint').textContent = mode === 'edit' ? 'Changes are kept when you choose Insert or Apply in Margin.' : 'A little space for your words.';
if (Number.isInteger(saved?.words)) status.textContent = saved.words + ' words';
function stage(value) { if (mode === 'edit') client.change(JSON.stringify(value)); }
text.addEventListener('input', () => { status.textContent = ''; stage({text:text.value}); });
document.querySelector('#count').addEventListener('click', async event => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const words = [...new Intl.Segmenter('en', {granularity:'word'}).segment(text.value)].filter(item => item.isWordLike).length;
    const result = {words, characters:[...text.value].length};
    status.textContent = result.words + ' words · ' + result.characters + ' characters';
    stage({text:text.value,words:result.words});
  } catch(error) { status.textContent = error.message; }
  finally { button.disabled = false; }
});
new ResizeObserver(() => client.resize(document.documentElement.scrollHeight)).observe(document.body);
window.addEventListener('pagehide', () => client.close(), {once:true});
</script></html>\n`;
}
