let model = null;
let results = [];
let queue = new Set();

// Carga de IA
async function initTF() {
    log("Iniciando motor de IA local (TensorFlow.js)...", "process");
    model = await use.load();
    document.getElementById('ai-status').innerText = "IA LISTA (BROWSER)";
    document.getElementById('ai-status').className = "text-[10px] font-mono text-green-500 uppercase italic";
    checkStartBtn();
}
initTF();

// 1. Descubrimiento
document.getElementById('search-btn').addEventListener('click', async () => {
    const dom = document.getElementById('domain-input').value.trim();
    if (!dom) return;
    log(`Consultando Serper para: ${dom}...`);
    const res = await fetch(`/api/search?domain=${dom}`);
    const urls = await res.json();
    urls.forEach(u => addUrlToList(u));
    document.getElementById('selection-area').classList.remove('hidden');
});

// 2. Manual
document.getElementById('add-manual-btn').addEventListener('click', () => {
    const val = document.getElementById('manual-url').value.trim();
    if (val.startsWith('http')) {
        addUrlToList(val);
        document.getElementById('manual-url').value = '';
        document.getElementById('selection-area').classList.remove('hidden');
    }
});

function addUrlToList(url) {
    if (document.querySelector(`input[value="${url}"]`)) return;
    const container = document.getElementById('url-list');
    const div = document.createElement('label');
    div.className = "flex items-center gap-2 p-1 hover:bg-white/5 cursor-pointer text-[10px] text-gray-400 truncate";
    div.innerHTML = `<input type="checkbox" value="${url}" class="url-cb accent-neon-pink"> <span class="truncate">${url}</span>`;
    div.querySelector('input').addEventListener('change', updateSelectionCount);
    container.prepend(div);
}

function updateSelectionCount() {
    const checked = document.querySelectorAll('.url-cb:checked').length;
    document.getElementById('selected-count').innerText = `${checked}/10`;
    checkStartBtn();
}

function checkStartBtn() {
    const btn = document.getElementById('start-btn');
    const checked = document.querySelectorAll('.url-cb:checked').length;
    if (model && checked > 0 && checked <= 10) {
        btn.disabled = false;
        btn.className = "w-full py-4 bg-neon-pink text-white font-bold rounded text-sm tracking-widest shadow-lg shadow-pink-900/40 cursor-pointer";
    } else {
        btn.disabled = true;
        btn.className = "w-full py-4 bg-gray-800 text-gray-500 font-bold rounded text-sm tracking-widest cursor-not-allowed";
    }
}

// 3. Análisis
document.getElementById('start-btn').addEventListener('click', async () => {
    const selected = Array.from(document.querySelectorAll('.url-cb:checked')).map(cb => cb.value);
    results = [];
    document.getElementById('results-table').innerHTML = '';
    document.getElementById('start-btn').disabled = true;
    log(`Iniciando análisis semántico de ${selected.length} páginas...`, "process");

    for (let url of selected) {
        try {
            log(`Scrapeando: ${url.split('/').pop() || url}`);
            const res = await fetch('/api/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url })
            });
            const json = await res.json();
            
            if (json.success) {
                const embeddings = await model.embed([json.data.text]);
                const vector = await embeddings.array();
                results.push({ url, topic: json.data.topic, vector: vector[0] });
                calculateMetrics();
            }
        } catch (e) { log(`Error en URL: ${url}`, "error"); }
    }
    document.getElementById('start-btn').disabled = false;
    log("Análisis finalizado.", "success");
});

function calculateMetrics() {
    if (results.length < 1) return;
    const dim = results[0].vector.length;
    let centroid = new Array(dim).fill(0);
    results.forEach(r => r.vector.forEach((v, i) => centroid[i] += v));
    centroid = centroid.map(v => v / results.length);

    results.forEach(r => r.sim = cosineSimilarity(r.vector, centroid));
    const focus = results.reduce((a, b) => a + b.sim, 0) / results.length;
    
    document.getElementById('metric-focus').innerText = (focus * 100).toFixed(1) + "%";
    renderResults();
}

function cosineSimilarity(a, b) {
    let dot = 0, mA = 0, mB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i]; mA += a[i] * a[i]; mB += b[i] * b[i];
    }
    return dot / (Math.sqrt(mA) * Math.sqrt(mB));
}

function renderResults() {
    const tbody = document.getElementById('results-table');
    tbody.innerHTML = results.map(r => `
        <tr class="border-b border-gray-900 hover:bg-white/5 transition">
            <td class="p-4 text-gray-400 truncate max-w-xs">${r.url}</td>
            <td class="p-4 text-neon-pink font-bold">${r.topic}</td>
            <td class="p-4 text-right font-bold ${r.sim > 0.7 ? 'text-green-500' : 'text-red-500'}">${(r.sim * 100).toFixed(1)}%</td>
        </tr>
    `).join('');
}

function log(msg, type = '') {
    const t = document.getElementById('terminal');
    const d = document.createElement('div');
    d.className = type === 'error' ? 'text-red-500' : (type === 'success' ? 'text-neon-pink' : '');
    d.innerText = `> ${msg}`;
    t.appendChild(d);
    t.scrollTop = t.scrollHeight;
}