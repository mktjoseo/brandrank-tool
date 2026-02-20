let state = {
    domain: 'Manual Input',
    urls: [],
    vectors: [],
    metrics: { focus: 0, radius: 0, ratio: 0 },
    topics: {}
};

// --- LOGGING ---
const consoleOutput = document.getElementById('console-output');
function log(msg, type = 'info') {
    if (!consoleOutput) return;
    const color = type === 'error' ? 'text-red-500' : (type === 'process' ? 'text-neon-pink' : (type === 'data' ? 'text-gray-500' : 'text-green-400'));
    const time = new Date().toLocaleTimeString('es-ES', {hour12:false});
    consoleOutput.innerHTML += `<div><span class="opacity-40 text-xs mr-2">[${time}]</span><span class="${color}">${msg}</span></div>`;
    document.getElementById('terminal-body').scrollTop = document.getElementById('terminal-body').scrollHeight;
}

// --- WIDGET MANUAL ---
async function analyzeManualUrls() {
    const text = document.getElementById('urlInput').value;
    const urls = text.split('\n').map(u => u.trim()).filter(u => u.startsWith('http'));
    
    if (urls.length === 0) return alert("Pega al menos una URL válida que empiece con http:// o https://");
    
    state.urls = urls;
    state.domain = new URL(urls[0]).hostname; 
    
    document.getElementById('step-results').classList.add('hidden');
    log(`🚀 Iniciando análisis de ${urls.length} URLs...`, 'process');
    
    await processUrlBatch(urls);
}

// --- SITEMAP DISCOVERY ---
async function startDiscovery() {
    const domain = document.getElementById('domainSearchInput').value.trim();
    if (!domain) return alert("Escribe un dominio para buscar");
    
    log(`🔎 Buscando URLs en ${domain}...`, 'process');
    try {
        const res = await fetch(`/api/search?domain=${domain}`);
        const data = await res.json();
        
        if (data.debugLogs) data.debugLogs.forEach(l => log(`SERVER: ${l}`, 'data'));
        if (!data.success) throw new Error(data.error);
        
        document.getElementById('urlInput').value = data.urls.join('\n');
        log(`✅ Se encontraron ${data.urls.length} URLs. Dale a 'Analizar URLs'.`, 'process');

    } catch (e) {
        log(`❌ Error de búsqueda: ${e.message}`, 'error');
    }
}

// --- ANALYZE BATCH ---
async function processUrlBatch(urls) {
    const results = [];
    const BATCH_SIZE = 3; 

    for (let i = 0; i < urls.length; i += BATCH_SIZE) {
        const batch = urls.slice(i, i + BATCH_SIZE);
        const promises = batch.map(url => 
            fetch('/api/analyze', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ url })
            }).then(r => r.json())
        );

        const batchResults = await Promise.all(promises);
        
        batchResults.forEach(data => {
            if (data.success && data.data) {
                results.push(data.data);
                log(`📄 OK [${data.data.url.split('/').pop() || 'home'}]: Categorizado como "${data.data.topic}"`, 'data');
            } else {
                log(`⚠️ Fallo en URL: ${data.error}`, 'error');
            }
        });
    }

    if (results.length > 0) {
        processMetrics(results);
        renderDashboard();
    } else {
        log("❌ Ninguna URL pudo ser analizada.", 'error');
    }
}

// --- MATH & VISUALS ---
function processMetrics(data) {
    const dim = data[0].vector.length;
    
    const centroid = new Array(dim).fill(0);
    data.forEach(d => d.vector.forEach((v, i) => centroid[i] += v));
    centroid.forEach((v, i) => centroid[i] /= data.length);

    state.vectors = data.map(d => {
        let dot = 0, mA = 0, mB = 0;
        for (let i = 0; i < dim; i++) {
            dot += d.vector[i] * centroid[i];
            mA += d.vector[i] ** 2;
            mB += centroid[i] ** 2;
        }
        const sim = dot / (Math.sqrt(mA) * Math.sqrt(mB));
        
        const r = (1 - sim) * 4; 
        const angle = Math.random() * Math.PI * 2; 

        return { ...d, sim, x: r * Math.cos(angle), y: r * Math.sin(angle) };
    });

    const sims = state.vectors.map(v => v.sim);
    const avg = sims.reduce((a,b) => a+b, 0) / sims.length;
    state.metrics.focus = avg.toFixed(3);
    state.metrics.ratio = Math.round((sims.filter(s => s > 0.65).length / sims.length) * 100);
    
    const variance = sims.reduce((a,b) => a + Math.pow(b - avg, 2), 0) / sims.length;
    state.metrics.radius = Math.sqrt(variance).toFixed(3);

    state.topics = {};
    state.vectors.forEach(v => state.topics[v.topic] = (state.topics[v.topic]||0)+1);
}

function renderDashboard() {
    document.getElementById('step-results').classList.remove('hidden');
    document.getElementById('download-btn').classList.remove('hidden');

    document.getElementById('val-focus').innerText = state.metrics.focus;
    document.getElementById('val-ratio').innerText = state.metrics.ratio + '%';
    document.getElementById('val-radius').innerText = state.metrics.radius;
    
    // Mostramos el Top Topic calculado por la IA
    const topTopic = Object.keys(state.topics).sort((a,b) => state.topics[b]-state.topics[a])[0] || 'Varios';
    document.getElementById('ai-summary').innerText = `Dominio: ${state.domain}\nEntidad Dominante: ${topTopic}\nCoherencia Semántica: ${state.metrics.ratio}%`;

    const tbody = document.getElementById('results-table-body');
    tbody.innerHTML = '';
    
    state.vectors.sort((a,b) => b.sim - a.sim).forEach(v => {
        const color = v.sim > 0.7 ? 'text-neon-green' : (v.sim > 0.5 ? 'text-yellow-400' : 'text-red-500');
        const status = v.sim > 0.7 ? 'PASS' : 'WARN';
        
        // TRANSPARENCIA: Pintamos los datos exactos que leyó el scraper (como en Colab)
        tbody.innerHTML += `
        <tr class="border-b border-gray-800 hover:bg-white/5 align-top">
            <td class="p-4 pl-2">
                <a href="${v.url}" target="_blank" class="text-neon-pink hover:text-white text-xs font-mono break-all inline-block mb-2">${v.url.replace(state.domain, '') || '/home'}</a>
                <div class="text-sm text-white font-bold mb-1 leading-tight">${v.extracted?.title || 'Sin Título'}</div>
                <div class="text-xs text-gray-500 font-sans"><span class="text-gray-700 font-mono">H1:</span> ${v.extracted?.h1 || 'Sin H1'}</div>
            </td>
            <td class="p-4 text-xs text-gray-400 leading-relaxed font-sans max-w-[300px]">
                <div class="line-clamp-3" title="${v.extracted?.snippet}">${v.extracted?.snippet || 'Sin Snippet'}</div>
            </td>
            <td class="p-4 text-center">
                <span class="inline-block px-2 py-1 bg-white/5 rounded text-xs font-bold text-neon-blue uppercase tracking-wider border border-neon-blue/20">${v.topic}</span>
            </td>
            <td class="p-4 text-right font-mono text-white text-base">${v.sim.toFixed(3)}</td>
            <td class="p-4 text-right pr-2 font-bold text-xs ${color}">${status}</td>
        </tr>`;
    });

    renderChart();
    document.getElementById('step-results').scrollIntoView({behavior:'smooth'});
}

// --- CHART JS ---
let chartInstance = null;
function renderChart() {
    const ctx = document.getElementById('scatterChart');
    if (!ctx) return;
    if (chartInstance) chartInstance.destroy();

    const colors = state.vectors.map(v => v.sim > 0.7 ? '#00ff9d' : (v.sim > 0.5 ? '#ffee00' : '#ff0055'));

    chartInstance = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'URLs', data: state.vectors, backgroundColor: colors, pointRadius: 6, pointHoverRadius: 10, pointBorderColor: 'rgba(0,0,0,0.5)', pointBorderWidth: 1
            }, {
                label: 'Centro', data: [{x:0, y:0}], pointRadius: 15, pointStyle: 'crossRot', borderColor: 'white', borderWidth: 2, backgroundColor: 'rgba(255,255,255,0.1)'
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: { x: {display:false, min:-3, max:3}, y: {display:false, min:-3, max:3} },
            plugins: { legend: {display:false}, tooltip: { callbacks: { label: (ctx) => ctx.raw.x===0 ? 'Centro' : `${ctx.raw.topic}: ${(ctx.raw.sim*100).toFixed(1)}%` } } }
        }
    });
}

// --- EXCEL ---
function downloadExcelReport() {
    if (!window.XLSX) return;
    const ws1 = XLSX.utils.aoa_to_sheet([["BrandRank Report"], ["Focus", state.metrics.focus], ["Ratio", state.metrics.ratio+"%"]]);
    const ws2 = XLSX.utils.aoa_to_sheet([
        ["URL", "Título Extraído", "H1 Extraído", "Tema IA", "Similitud", "Estado"], 
        ...state.vectors.map(v => [v.url, v.extracted?.title, v.extracted?.h1, v.topic, v.sim, v.sim>0.7?"PASS":"FAIL"])
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, "Resumen");
    XLSX.utils.book_append_sheet(wb, ws2, "Detalle");
    XLSX.writeFile(wb, `brandrank_audit.xlsx`);
}

// DRAG CONSOLE
const handle = document.getElementById('drag-handle');
const footer = document.getElementById('console-footer');
if(handle && footer) {
    let isDragging = false, startY, startHeight;
    handle.addEventListener('mousedown', (e) => { isDragging = true; startY = e.clientY; startHeight = footer.offsetHeight; document.body.style.cursor = 'row-resize'; });
    document.addEventListener('mousemove', (e) => { if(!isDragging) return; footer.style.height = `${Math.min(Math.max(startHeight + (startY - e.clientY), 35), window.innerHeight * 0.8)}px`; });
    document.addEventListener('mouseup', () => { isDragging = false; document.body.style.cursor = 'default'; });
}