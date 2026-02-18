// --- CONFIGURACIÓN & ESTADO ---
const ProjectManager = {
    getKey: () => 'brandrank_projects',
    getAll: () => JSON.parse(localStorage.getItem(ProjectManager.getKey()) || '[]'),
    save: (p) => {
        const ps = ProjectManager.getAll();
        const i = ps.findIndex(x => x.domain === p.domain);
        if (i >= 0) ps[i] = p; else ps.unshift(p);
        localStorage.setItem(ProjectManager.getKey(), JSON.stringify(ps));
        renderHistory();
        log(`Proyecto guardado: ${p.domain}`, 'process');
    },
    load: (d) => ProjectManager.getAll().find(p => p.domain === d),
    delete: (d) => {
        localStorage.setItem(ProjectManager.getKey(), JSON.stringify(ProjectManager.getAll().filter(p => p.domain !== d)));
        renderHistory();
    },
    clearAll: () => { localStorage.removeItem(ProjectManager.getKey()); renderHistory(); }
};

let state = {
    domain: '', urls: [], selectedUrls: [], vectors: [], 
    metrics: { focus: 0, radius: 0, ratio: 0 }, 
    topics: {}, summary: '', isSimulating: false
};

// --- API CLIENTS ---
async function fetchSitemapOrSearch(domain) {
    if (state.isSimulating) return mockDiscovery(domain);
    
    try {
        log(`Backend: Buscando sitemap/urls para ${domain}...`, 'process');
        const res = await fetch(`/api/search?domain=${domain}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.error);
        return data.urls;
    } catch (e) {
        log(`Error API: ${e.message}`, 'error');
        return [];
    }
}

async function processUrlBatch(urls) {
    if (state.isSimulating) return mockAnalysis(urls);

    const results = [];
    // Procesamos de 1 en 1 para no saturar la API ni el timeout de Vercel
    for (const url of urls) {
        try {
            log(`Backend: Scrapeando & Vectorizando ${url}...`, 'process');
            const res = await fetch('/api/analyze', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ url, domain: state.domain })
            });
            const data = await res.json();
            
            if (data.success) {
                results.push(data.data); // { url, vector, topic, summary }
                log(`OK: ${url}`, 'info');
            } else {
                log(`Fallo en ${url}: ${data.error}`, 'warn');
            }
        } catch (e) {
            log(`Error red: ${e.message}`, 'error');
        }
    }
    return results;
}

// --- CORE APP FLOW ---

async function startDiscovery() {
    const input = document.getElementById('domainInput');
    const domain = input.value.trim();
    state.isSimulating = document.getElementById('simulationMode').checked;

    if (!domain) return;
    state.domain = domain;
    resetUI();
    
    log(`Iniciando discovery para ${domain} (Modo: ${state.isSimulating ? 'SIMULADO' : 'REAL'})...`, 'process');
    
    const urls = await fetchSitemapOrSearch(domain);
    if (urls.length === 0) {
        log("No se encontraron URLs. Intenta de nuevo.", 'error');
        return;
    }

    state.urls = urls;
    log(`Encontradas ${urls.length} URLs candidatas.`, 'info');
    renderUrlList();
}

async function analyzeSelected() {
    const checked = Array.from(document.querySelectorAll('#url-list input:checked')).map(c => c.value);
    if (checked.length === 0) return alert("Selecciona URLs");
    state.selectedUrls = checked;
    
    document.getElementById('step-selection').classList.add('opacity-50', 'pointer-events-none');
    
    // 1. Obtener Vectores (Backend)
    const rawData = await processUrlBatch(checked);
    
    if (rawData.length === 0) {
        alert("Falló el análisis. Revisa la consola.");
        document.getElementById('step-selection').classList.remove('opacity-50', 'pointer-events-none');
        return;
    }

    // 2. Calcular Matemáticas (Frontend)
    processVectorsAndMetrics(rawData);

    // 3. Render
    renderResultsDashboard();
    log('Análisis finalizado.', 'process');
}

// --- MATH & METRICS ---
function cosineSimilarity(vecA, vecB) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dot += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function processVectorsAndMetrics(rawData) {
    // Calcular Centroide
    const dim = rawData[0].vector.length;
    const centroid = new Array(dim).fill(0);
    
    rawData.forEach(item => {
        for(let i=0; i<dim; i++) centroid[i] += item.vector[i];
    });
    for(let i=0; i<dim; i++) centroid[i] /= rawData.length;

    // Calcular Similitudes y Proyección 2D (Fake PCA para visualización)
    state.vectors = rawData.map(item => {
        const sim = cosineSimilarity(item.vector, centroid);
        // Visuals
        const r = (1 - sim) * 4; 
        const angle = Math.random() * 6.28;
        return {
            url: item.url,
            sim: sim,
            topic: item.topic || 'General',
            x: r * Math.cos(angle),
            y: r * Math.sin(angle)
        };
    });

    // Calcular Métricas Globales
    const vs = state.vectors;
    const sorted = [...vs].sort((a,b) => b.sim - a.sim);
    
    // Focus: Top 25% avg
    const top25 = sorted.slice(0, Math.ceil(vs.length * 0.25));
    const focus = top25.reduce((a,b) => a+b.sim, 0) / top25.length;
    
    // Radius: Standard Deviation
    const meanDist = vs.reduce((a,v) => a + (1-v.sim), 0) / vs.length;
    const variance = vs.reduce((a,v) => a + Math.pow((1-v.sim) - meanDist, 2), 0) / vs.length;
    const radius = Math.sqrt(variance);
    
    // Ratio: > 0.70 sim
    const ratio = (vs.filter(v => v.sim > 0.7).length / vs.length) * 100;

    state.metrics = { focus: focus.toFixed(3), radius: radius.toFixed(3), ratio: Math.round(ratio) };
    
    // Topics count
    state.topics = {};
    vs.forEach(v => { state.topics[v.topic] = (state.topics[v.topic] || 0) + 1; });
    
    // Summary Text
    const primary = Object.entries(state.topics).sort((a,b) => b[1]-a[1])[0]?.[0] || 'Varios';
    state.summary = `Entidad: ${state.domain}.\nFoco Principal: ${primary}.\nSite Focus: ${state.metrics.focus}. Site Radius: ${state.metrics.radius}.`;
}

// --- EXCEL EXPORT (La parte nueva) ---
function downloadExcelReport() {
    if (!state.domain || state.vectors.length === 0) return;
    
    // 1. Hoja de Resumen
    const summaryData = [
        ["BrandRank AI Report", ""],
        ["Dominio", state.domain],
        ["Fecha", new Date().toLocaleDateString()],
        ["", ""],
        ["Métricas Globales", ""],
        ["Site Focus", state.metrics.focus],
        ["Site Radius", state.metrics.radius],
        ["Site Ratio", state.metrics.ratio + "%"],
        ["Veredicto", state.metrics.ratio > 75 ? "EXCELENTE" : "REQUIERE ATENCIÓN"],
        ["", ""],
        ["Resumen IA", state.summary]
    ];

    // 2. Hoja de Datos (URLs)
    const detailsData = [
        ["URL", "Temática Detectada", "Similitud Vectorial", "Estado", "Distancia al Foco"]
    ];
    
    state.vectors.sort((a,b) => b.sim - a.sim).forEach(v => {
        detailsData.push([
            v.url,
            v.topic,
            parseFloat(v.sim.toFixed(4)),
            v.sim > 0.7 ? "PASS" : "FAIL",
            parseFloat((1 - v.sim).toFixed(4))
        ]);
    });

    // Crear Workbook
    const wb = XLSX.utils.book_new();
    
    const wsSummary = XLSX.utils.aoa_to_sheet(summaryData);
    const wsDetails = XLSX.utils.aoa_to_sheet(detailsData);
    
    // Ajustar anchos de columna (cosmético)
    wsDetails['!cols'] = [{wch: 50}, {wch: 20}, {wch: 15}, {wch: 10}, {wch: 15}];

    XLSX.utils.book_append_sheet(wb, wsSummary, "Resumen");
    XLSX.utils.book_append_sheet(wb, wsDetails, "Detalle URLs");

    // Guardar archivo
    XLSX.writeFile(wb, `${state.domain}_BrandRank_Audit.xlsx`);
    log("Reporte Excel descargado.", 'process');
}


// --- UI RENDERING & MOCKS ---
// (Aquí iría el código de renderUrlList, renderChart, mockDiscovery y mockAnalysis 
// que es idéntico al de la versión anterior, solo asegúrate de pegarlo aquí)

// ... Resto de funciones UI (renderChart, toggleHistory, etc) ...
// Copia las funciones de UI del index.html anterior aquí.

// Inicialización
renderHistory();
log("Sistema listo. Configura tus API Keys en el archivo .env", 'info');

// Funciones Auxiliares UI (Simplificadas para el ejemplo)
function resetUI() {
    document.getElementById('step-selection').classList.add('hidden');
    document.getElementById('step-results').classList.add('hidden');
    document.getElementById('download-btn').classList.add('hidden');
}
function renderUrlList() {
    const c = document.getElementById('url-list'); c.innerHTML = '';
    state.urls.forEach((u,i) => {
        c.innerHTML += `<label class="flex gap-2 p-2 hover:bg-white/5 cursor-pointer"><input type="checkbox" value="${u}" ${i<10?'checked':''} class="accent-neon-blue"><span class="text-sm text-gray-400 truncate">${u}</span></label>`;
    });
    document.getElementById('step-selection').classList.remove('hidden');
    document.getElementById('step-selection').classList.remove('opacity-50', 'pointer-events-none');
}
function renderResultsDashboard() {
    document.getElementById('step-results').classList.remove('hidden');
    document.getElementById('download-btn').classList.remove('hidden');
    document.getElementById('val-focus').innerText = state.metrics.focus;
    document.getElementById('bar-focus').style.width = (state.metrics.focus*100)+'%';
    document.getElementById('val-radius').innerText = state.metrics.radius;
    document.getElementById('bar-radius').style.width = Math.max(0, (1-(state.metrics.radius*3))*100)+'%';
    document.getElementById('val-ratio').innerText = state.metrics.ratio+'%';
    document.getElementById('bar-ratio').style.width = state.metrics.ratio+'%';
    document.getElementById('final-verdict').innerText = state.metrics.ratio > 75 ? 'ALTA CALIDAD' : 'REVISAR';
    
    document.getElementById('ai-summary').innerText = state.summary;
    const tBody = document.getElementById('results-table-body'); tBody.innerHTML = '';
    state.vectors.forEach(v => {
        tBody.innerHTML += `<tr class="border-b border-gray-800"><td class="truncate max-w-xs py-2">${v.url}</td><td class="text-center">${v.topic}</td><td class="text-right text-white">${v.sim.toFixed(3)}</td><td class="text-right text-${v.sim>0.7?'green':'red'}-500">${v.sim>0.7?'OK':'FAIL'}</td></tr>`;
    });
    renderChart();
}
// ChartJS logic igual que antes
function renderChart() {
    const ctx = document.getElementById('scatterChart').getContext('2d');
    if(window.myChart) window.myChart.destroy();
    window.myChart = new Chart(ctx, {
        type: 'scatter',
        data: { datasets: [{ label: 'Nodes', data: state.vectors, backgroundColor: c=>c.raw.sim>0.7?'#00ff9d':'#ff0055' }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { x:{display:false}, y:{display:false} } }
    });
}
// Mock Functions
function mockDiscovery(d) { return new Promise(r => setTimeout(() => r([`https://${d}/`, `https://${d}/about`, `https://${d}/blog/1`]), 1000)); }
function mockAnalysis(urls) { 
    return new Promise(r => setTimeout(() => r(urls.map(u => ({
        url: u, vector: Array(10).fill(0).map(()=>Math.random()), topic: 'Mock Topic'
    }))), 1500)); 
}