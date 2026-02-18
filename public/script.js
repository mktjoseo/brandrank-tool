// CONFIGURACIÓN Y ESTADO
let state = {
    domain: '',
    urls: [],
    selectedUrls: [],
    vectors: [],
    metrics: { focus: 0, radius: 0, ratio: 0 },
    topics: {},
    summary: ''
};

// UTILS & LOGGING
const consoleOutput = document.getElementById('console-output');
const terminalBody = document.getElementById('terminal-body');

function log(message, type = 'info') {
    if (!consoleOutput) return;
    const line = document.createElement('div');
    const time = new Date().toLocaleTimeString('es-ES', { hour12: false });
    
    let color = 'text-green-400';
    if (type === 'error') color = 'text-red-500';
    if (type === 'warn') color = 'text-yellow-400';
    if (type === 'process') color = 'text-neon-pink';
    if (type === 'data') color = 'text-gray-500 italic';

    line.innerHTML = `<span class="opacity-30 select-none mr-3">[${time}]</span><span class="${color}">${message}</span>`;
    consoleOutput.appendChild(line);
    
    if (terminalBody) terminalBody.scrollTop = terminalBody.scrollHeight;
}

function animateValue(id, start, end, duration, isPercent = false) {
    const obj = document.getElementById(id);
    if (!obj) return;
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        let val = progress * (end - start) + start;
        obj.innerHTML = isPercent ? Math.floor(val) + '%' : val.toFixed(3);
        if (progress < 1) window.requestAnimationFrame(step);
        else obj.innerHTML = isPercent ? end + '%' : end.toFixed(3);
    };
    window.requestAnimationFrame(step);
}

// API CALLS
async function fetchSitemapOrSearch(domain) {
    try {
        log(`Backend: Buscando URLs para ${domain}...`, 'process');
        const res = await fetch(`/api/search?domain=${domain}`);
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.error);
        return data.urls || [];
    } catch (e) {
        log(`Error Discovery: ${e.message}`, 'error');
        return [];
    }
}

async function processUrlBatch(urls) {
    const results = [];
    let processed = 0;
    log(`Procesando lote de ${urls.length} URLs...`, 'info');

    for (const url of urls) {
        try {
            log(`Analizando: ${url}...`, 'data');
            const res = await fetch('/api/analyze', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ url })
            });
            const data = await res.json();
            
            if (data.success && data.data) {
                results.push(data.data);
                processed++;
            } else {
                log(`Fallo parcial: ${data.error}`, 'warn');
            }
        } catch (e) {
            log(`Error red: ${e.message}`, 'error');
        }
    }
    log(`Lote completado. Éxito: ${processed}/${urls.length}`, 'process');
    return results;
}

// MAIN LOGIC
async function startDiscovery() {
    const input = document.getElementById('domainInput');
    const domain = input.value.trim();
    if (!domain) { log("Ingresa un dominio.", 'warn'); return; }

    state.domain = domain;
    resetUI();
    log(`Iniciando auditoría para: ${domain}`, 'process');
    
    const urls = await fetchSitemapOrSearch(domain);
    if (!urls || urls.length === 0) {
        log("No se encontraron URLs.", 'error');
        return;
    }
    state.urls = urls;
    log(`Encontradas ${urls.length} URLs.`, 'info');
    renderUrlList();
}

async function analyzeSelected() {
    const checked = Array.from(document.querySelectorAll('#url-list input:checked')).map(c => c.value);
    if (checked.length === 0) { alert("Selecciona URLs"); return; }
    
    state.selectedUrls = checked;
    const selSection = document.getElementById('step-selection');
    if(selSection) selSection.classList.add('opacity-50', 'pointer-events-none');
    
    const rawData = await processUrlBatch(checked);
    if (rawData.length === 0) {
        log("Fallo crítico en análisis.", 'error');
        if(selSection) selSection.classList.remove('opacity-50', 'pointer-events-none');
        return;
    }

    processVectorsAndMetrics(rawData);
    renderResultsDashboard();
}

// MATH
function cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dot += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function processVectorsAndMetrics(rawData) {
    if (rawData.length === 0) return;
    const dim = rawData[0].vector.length;
    const centroid = new Array(dim).fill(0);
    
    rawData.forEach(item => { for(let i=0; i<dim; i++) centroid[i] += item.vector[i]; });
    for(let i=0; i<dim; i++) centroid[i] /= rawData.length;

    state.vectors = rawData.map(item => {
        const sim = cosineSimilarity(item.vector, centroid);
        const r = (1 - sim) * 5; 
        const angle = Math.random() * 6.28;
        return {
            url: item.url, sim, topic: item.topic || 'General',
            x: r * Math.cos(angle), y: r * Math.sin(angle)
        };
    });

    const vs = state.vectors;
    const sorted = [...vs].sort((a,b) => b.sim - a.sim);
    const top25 = sorted.slice(0, Math.ceil(vs.length * 0.25));
    const focus = top25.length > 0 ? top25.reduce((a,b) => a+b.sim, 0) / top25.length : 0;
    
    const meanDist = vs.reduce((a,v) => a + (1-v.sim), 0) / vs.length;
    const variance = vs.reduce((a,v) => a + Math.pow((1-v.sim) - meanDist, 2), 0) / vs.length;
    const radius = Math.sqrt(variance);
    const ratio = (vs.filter(v => v.sim > 0.7).length / vs.length) * 100;

    state.metrics = { focus: parseFloat(focus.toFixed(3)), radius: parseFloat(radius.toFixed(3)), ratio: Math.round(ratio) };
    
    state.topics = {};
    vs.forEach(v => { state.topics[v.topic] = (state.topics[v.topic] || 0) + 1; });
    const topTopic = Object.entries(state.topics).sort((a,b) => b[1]-a[1])[0]?.[0] || 'Varios';
    state.summary = `Entidad: ${state.domain}\nFoco Principal: ${topTopic}\nMetricas: Focus ${state.metrics.focus} | Ratio ${state.metrics.ratio}%`;
}

// UI
function resetUI() {
    document.getElementById('step-selection').classList.add('hidden');
    document.getElementById('step-results').classList.add('hidden');
    const dl = document.getElementById('download-btn'); if(dl) dl.classList.add('hidden');
}

function renderUrlList() {
    const container = document.getElementById('url-list');
    if (!container) return;
    container.innerHTML = '';
    state.urls.forEach((url, i) => {
        const isChecked = i < 10 ? 'checked' : '';
        const html = `<label class="flex items-center gap-3 p-2 hover:bg-white/5 cursor-pointer border-b border-gray-800/50">
            <input type="checkbox" value="${url}" ${isChecked} class="w-4 h-4 rounded border-gray-600 bg-transparent text-neon-pink focus:ring-0">
            <span class="text-sm font-mono text-gray-400 truncate w-full">${url}</span></label>`;
        container.insertAdjacentHTML('beforeend', html);
    });
    const s = document.getElementById('step-selection');
    s.classList.remove('hidden', 'opacity-50', 'pointer-events-none');
    s.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function selectAll() { document.querySelectorAll('#url-list input').forEach(c => c.checked = true); }

function renderResultsDashboard() {
    const res = document.getElementById('step-results');
    res.classList.remove('hidden');
    const dl = document.getElementById('download-btn'); if(dl) dl.classList.remove('hidden');

    animateValue('val-focus', 0, state.metrics.focus, 1000);
    document.getElementById('bar-focus').style.width = (state.metrics.focus * 100) + '%';
    
    animateValue('val-radius', 0, state.metrics.radius, 1000);
    const radPct = Math.max(0, (1 - (state.metrics.radius * 3)) * 100);
    document.getElementById('bar-radius').style.width = radPct + '%';
    
    animateValue('val-ratio', 0, state.metrics.ratio, 1000, true);
    document.getElementById('bar-ratio').style.width = state.metrics.ratio + '%';

    const verdict = document.getElementById('final-verdict');
    if (state.metrics.ratio > 75) { verdict.innerText = "EXCELENTE"; verdict.className = "text-xl font-bold text-neon-green"; }
    else if (state.metrics.ratio > 50) { verdict.innerText = "MODERADO"; verdict.className = "text-xl font-bold text-yellow-400"; }
    else { verdict.innerText = "RIESGO"; verdict.className = "text-xl font-bold text-red-500"; }

    document.getElementById('ai-summary').innerText = state.summary;
    const tagCont = document.getElementById('topic-tags'); tagCont.innerHTML = '';
    Object.keys(state.topics).forEach(t => tagCont.innerHTML += `<span class="topic-badge border-gray-600 text-gray-400">${t}</span>`);

    const tbody = document.getElementById('results-table-body'); tbody.innerHTML = '';
    state.vectors.sort((a,b) => b.sim - a.sim).forEach(v => {
        const status = v.sim > 0.7 ? 'text-neon-green' : 'text-red-500';
        tbody.innerHTML += `<tr class="border-b border-gray-800 hover:bg-white/5"><td class="py-2 pl-2 truncate max-w-[200px]" title="${v.url}">${v.url}</td><td class="text-center text-gray-500 text-xs">${v.topic}</td><td class="text-right font-mono text-white">${v.sim.toFixed(3)}</td><td class="text-right pr-2 font-bold text-xs ${status}">${v.sim > 0.7 ? 'PASS' : 'FAIL'}</td></tr>`;
    });

    renderChart();
    res.scrollIntoView({ behavior: 'smooth' });
}

let chartInstance = null;
function renderChart() {
    const ctx = document.getElementById('scatterChart');
    if (!ctx) return;
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'URLs', data: state.vectors,
                backgroundColor: c => c.raw?.sim > 0.8 ? '#ffffff' : (c.raw?.sim > 0.6 ? '#00f3ff' : '#ff007f'),
                pointRadius: 5
            }, {
                label: 'Centroide', data: [{x:0, y:0}], pointStyle: 'crossRot', pointRadius: 10, borderColor: 'rgba(255,255,255,0.5)', borderWidth: 2
            }]
        },
        options: { responsive: true, maintainAspectRatio: false, scales: { x: {display:false}, y: {display:false} }, plugins: { legend: {display:false} } }
    });
}

function downloadExcelReport() {
    if (!state.domain) return;
    const ws1 = XLSX.utils.aoa_to_sheet([["BrandRank Report"], ["Dominio", state.domain], ["Focus", state.metrics.focus], ["Ratio", state.metrics.ratio+"%"]]);
    const ws2 = XLSX.utils.aoa_to_sheet([["URL","Topic","Sim","Status"], ...state.vectors.map(v => [v.url, v.topic, v.sim, v.sim>0.7?"PASS":"FAIL"])]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, "Resumen");
    XLSX.utils.book_append_sheet(wb, ws2, "Detalles");
    XLSX.writeFile(wb, `${state.domain}_audit.xlsx`);
}

// Drag Handle
const handle = document.getElementById('drag-handle');
const footer = document.getElementById('console-footer');
if(handle && footer) {
    let isDragging = false, startY, startHeight;
    handle.addEventListener('mousedown', (e) => { 
        if(e.target.closest('button')) return;
        isDragging = true; startY = e.clientY; startHeight = footer.offsetHeight; 
        document.body.style.cursor = 'row-resize';
    });
    document.addEventListener('mousemove', (e) => { 
        if(!isDragging) return; 
        const h = Math.min(Math.max(startHeight + (startY - e.clientY), 35), window.innerHeight * 0.8);
        footer.style.height = `${h}px`; 
    });
    document.addEventListener('mouseup', () => { isDragging = false; document.body.style.cursor = 'default'; });
}

log("Sistema v2.0 Inicializado.", 'info');