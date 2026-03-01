const form = document.getElementById('prompt-form');
const input = document.getElementById('prompt-input');
const modelSelect = document.getElementById('model-select');
const responseArea = document.getElementById('response-area');

let firstMessage = true;

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const prompt = input.value.trim();
  if (!prompt) return;

  if (firstMessage) {
    responseArea.innerHTML = '';
    firstMessage = false;
  }

  appendMessage('user', prompt);
  input.value = '';
  input.style.height = 'auto';

  const sendBtn = form.querySelector('button[type="submit"]');
  sendBtn.disabled = true;

  try {
    const res = await fetch('/api/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, model: modelSelect.value }),
    });

    const data = await res.json();

    if (res.ok) {
      appendMessage('assistant', data.response);
    } else {
      appendMessage('error', data.error || 'Something went wrong.');
    }
  } catch (err) {
    appendMessage('error', 'Failed to connect to server.');
  } finally {
    sendBtn.disabled = false;
    input.focus();
  }
});

// Auto-resize textarea
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 200) + 'px';
});

// Ctrl+Enter / Cmd+Enter to submit
input.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    form.requestSubmit();
  }
});

function appendMessage(role, text) {
  const wrapper = document.createElement('div');
  wrapper.className = role === 'user'
    ? 'flex justify-end'
    : 'flex justify-start';

  const bubble = document.createElement('div');

  if (role === 'user') {
    bubble.className = 'max-w-[80%] bg-indigo-600/20 border border-indigo-500/30 text-zinc-100 rounded-xl px-4 py-3 text-sm leading-relaxed';
  } else if (role === 'error') {
    bubble.className = 'max-w-[80%] bg-red-600/10 border border-red-500/30 text-red-400 rounded-xl px-4 py-3 text-sm leading-relaxed';
  } else {
    bubble.className = 'max-w-[80%] bg-zinc-800/60 border border-zinc-700/50 text-zinc-200 rounded-xl px-4 py-3 text-sm leading-relaxed';
  }

  bubble.textContent = text;
  wrapper.appendChild(bubble);
  responseArea.appendChild(wrapper);
  responseArea.scrollTop = responseArea.scrollHeight;
}
