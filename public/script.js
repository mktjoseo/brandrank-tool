// --- 1. UTILS & LOGGING (Definidos primero para evitar errores) ---

const consoleOutput = document.getElementById('console-output');
const terminalBody = document.getElementById('terminal-body');

function log(message, type = 'info') {
    if (!consoleOutput) return; // Seguridad si el DOM no cargó
    const line = document.createElement('div');
    const time = new Date().toLocaleTimeString('es-ES', { hour12: false });
    
    let color = 'text-green-400';
    if (type === 'error') color = 'text-red-500';
    if (type === 'warn') color = 'text-yellow-400';
    if (type === 'process') color = 'text-neon-pink'; // Ajustado a tu branding
    if (type === 'data') color = 'text-gray-500 italic';

    line.innerHTML = `<span class="opacity-30 select-none mr-2">[${time}]</span><span class="${color}">${message}</span>`;
    consoleOutput.appendChild(line);
    
    // Auto scroll
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
        if (progress < 1) {
            window.requestAnimationFrame(step);
        } else {
            obj.innerHTML = isPercent ? end + '%' : end.toFixed(3);
        }
    };
    window.requestAnimationFrame(step);
}

// --- 2. STATE & CONFIG ---

const ProjectManager = {
    getKey: () => 'brandrank_projects',
    getAll: () => {
        try {
            return JSON.parse(localStorage.getItem(ProjectManager.getKey()) || '[]');
        } catch (e) { return []; }
    },
    save: (p) => {
        const ps = ProjectManager.getAll();
        const i = ps.findIndex(x => x.domain === p.domain);
        if (i >= 0) ps[i] = p; else ps.unshift(p);
        localStorage.setItem(ProjectManager.getKey(), JSON.stringify(ps));
        // Si tienes sidebar de historial, aquí llamas a renderHistory()
        log(`Proyecto guardado localmente: ${p.domain}`, 'process');
    },
    clearAll: () => {
        localStorage.removeItem(ProjectManager.getKey());
        log("Memoria local borrada.", 'warn');
    }
};

let state = {
    domain: '',
    urls: [],
    selectedUrls: [],
    vectors: [],
    metrics: { focus: 0, radius: 0, ratio: 0 },
    topics: {},
    summary: '',
    isSimulating: false // Por defecto false para prod
};

// --- 3. API CALLS ---

async function fetchSitemapOrSearch(domain) {
    if (state.isSimulating) return mockDiscovery(domain);
    
    try {
        log(`Backend: Iniciando búsqueda para ${domain}...`, 'process');
        // Llamada a tu API Vercel
        const res = await fetch(`/api/search?domain=${domain}`);
        if (!res.ok) throw new Error(`Error HTTP: ${res.status}`);
        
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Error desconocido en API');
        
        return data.urls || [];
    } catch (e) {
        log(`Error en Discovery: ${e.message}`, 'error');
        return [];
    }
}

async function processUrlBatch(urls) {
    if (state.isSimulating) return mockAnalysis(urls);

    const results = [];
    let processed = 0;
    
    log(`Procesando lote de ${urls.length} URLs...`, 'info');

    for (const url of urls) {
        try {
            // Log ligero para no saturar
            log(`Analizando: ${url}...`, 'data');
            
            const res = await fetch('/api/analyze', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ url, domain: state.domain })
            });
            
            const data = await res.json();
            
            if (data.success && data.data) {
                results.push(data.data);
                processed++;
            } else {
                log(`Fallo parcial en ${url}: ${data.error}`, 'warn');
            }
        } catch (e) {
            log(`Error red en ${url}: ${e.message}`, 'error');
        }
    }
    
    log(`Lote completado. Éxito: ${processed}/${urls.length}`, 'process');
    return results;
}

// --- 4. CORE LOGIC & MATH ---

async function startDiscovery() {
    const input = document.getElementById('domainInput');
    const domain = input.value.trim();
    
    // Checkbox eliminado del HTML, forzamos false o lo dejamos si decides volver a ponerlo
    state.isSimulating = false; 

    if (!domain) {
        log("Por favor ingresa un dominio.", 'warn');
        return;
    }

    state.domain = domain;
    resetUI(); // Limpia resultados anteriores
    
    log(`Iniciando auditoría para: ${domain}`, 'process');
    
    const urls = await fetchSitemapOrSearch(domain);
    
    if (!urls || urls.length === 0) {
        log("No se encontraron URLs. Verifica el dominio o intenta más tarde.", 'error');
        return;
    }

    state.urls = urls;
    log(`Encontradas ${urls.length} URLs candidatas.`, 'info');
    renderUrlList();
}

async function analyzeSelected() {
    const checked = Array.from(document.querySelectorAll('#url-list input:checked')).map(c => c.value);
    
    if (checked.length === 0) {
        alert("Selecciona al menos 1 URL para analizar.");
        return;
    }
    
    state.selectedUrls = checked;
    
    // UI Feedback
    const selSection = document.getElementById('step-selection');
    if(selSection) selSection.classList.add('opacity-50', 'pointer-events-none');
    
    // 1. Get Vectors
    const rawData = await processUrlBatch(checked);
    
    if (rawData.length === 0) {
        log("No se pudieron obtener vectores. Revisa API Keys o cuota.", 'error');
        if(selSection) selSection.classList.remove('opacity-50', 'pointer-events-none');
        return;
    }

    // 2. Compute Metrics
    processVectorsAndMetrics(rawData);

    // 3. Render
    renderResultsDashboard();
    
    // Auto-save
    ProjectManager.save({
        domain: state.domain,
        metrics: state.metrics,
        timestamp: Date.now()
    });
}

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
    // Calcular Centroide
    if (rawData.length === 0) return;
    
    const dim = rawData[0].vector.length;
    const centroid = new Array(dim).fill(0);
    
    rawData.forEach(item => {
        for(let i=0; i<dim; i++) centroid[i] += item.vector[i];
    });
    for(let i=0; i<dim; i++) centroid[i] /= rawData.length;

    // Calcular Similitudes y Proyección Fake-PCA
    state.vectors = rawData.map(item => {
        const sim = cosineSimilarity(item.vector, centroid);
        // Visuals: Cuanto menos similar, más lejos (radio mayor)
        const r = (1 - sim) * 5; 
        const angle = Math.random() * 6.28;
        
        return {
            url: item.url,
            sim: sim,
            topic: item.topic || 'General',
            x: r * Math.cos(angle),
            y: r * Math.sin(angle)
        };
    });

    // Métricas
    const vs = state.vectors;
    const sorted = [...vs].sort((a,b) => b.sim - a.sim);
    
    // Focus (Top 25%)
    const top25 = sorted.slice(0, Math.ceil(vs.length * 0.25));
    const focus = top25.reduce((a,b) => a+b.sim, 0) / top25.length;
    
    // Radius (Std Dev)
    const meanDist = vs.reduce((a,v) => a + (1-v.sim), 0) / vs.length;
    const variance = vs.reduce((a,v) => a + Math.pow((1-v.sim) - meanDist, 2), 0) / vs.length;
    const radius = Math.sqrt(variance);
    
    // Ratio (> 0.7)
    const ratio = (vs.filter(v => v.sim > 0.7).length / vs.length) * 100;

    state.metrics = { 
        focus: parseFloat(focus.toFixed(3)), 
        radius: parseFloat(radius.toFixed(3)), 
        ratio: Math.round(ratio) 
    };
    
    // Topics & Summary
    state.topics = {};
    vs.forEach(v => { state.topics[v.topic] = (state.topics[v.topic] || 0) + 1; });
    const topTopic = Object.entries(state.topics).sort((a,b) => b[1]-a[1])[0]?.[0] || 'Varios';
    
    state.summary = `Dominio: ${state.domain}\nFoco Principal Detectado: ${topTopic}\n\nMétricas:\n- Site Focus: ${state.metrics.focus} (Objetivo > 0.8)\n- Site Radius: ${state.metrics.radius} (Objetivo < 0.15)\n- Site Ratio: ${state.metrics.ratio}% (URLs útiles)`;
}

// --- 5. UI RENDERING ---

function resetUI() {
    document.getElementById('step-selection').classList.add('hidden');
    document.getElementById('step-results').classList.add('hidden');
    const dlBtn = document.getElementById('download-btn');
    if(dlBtn) dlBtn.classList.add('hidden');
}

function renderUrlList() {
    const container = document.getElementById('url-list');
    if (!container) return;
    
    container.innerHTML = '';
    state.urls.forEach((url, i) => {
        // Seleccionamos las primeras 10 por defecto
        const isChecked = i < 10 ? 'checked' : '';
        const html = `
            <label class="flex items-center gap-3 p-2 hover:bg-white/5 cursor-pointer border-b border-gray-800/50">
                <input type="checkbox" value="${url}" ${isChecked} class="w-4 h-4 rounded border-gray-600 bg-transparent text-neon-pink focus:ring-0">
                <span class="text-sm font-mono text-gray-400 truncate w-full">${url}</span>
            </label>
        `;
        container.insertAdjacentHTML('beforeend', html);
    });

    const stepSel = document.getElementById('step-selection');
    stepSel.classList.remove('hidden');
    stepSel.classList.remove('opacity-50', 'pointer-events-none');
    stepSel.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function selectAll() {
    document.querySelectorAll('#url-list input').forEach(c => c.checked = true);
}

function renderResultsDashboard() {
    const resSection = document.getElementById('step-results');
    resSection.classList.remove('hidden');
    
    const dlBtn = document.getElementById('download-btn');
    if(dlBtn) dlBtn.classList.remove('hidden');

    // Métricas
    animateValue('val-focus', 0, state.metrics.focus, 1000);
    document.getElementById('bar-focus').style.width = (state.metrics.focus * 100) + '%';
    
    animateValue('val-radius', 0, state.metrics.radius, 1000);
    // Invertir barra radius: menos es mejor. Si radius es 0, barra 100%. Si radius > 0.3, barra 0%
    const radPct = Math.max(0, (1 - (state.metrics.radius * 3)) * 100);
    document.getElementById('bar-radius').style.width = radPct + '%';
    
    animateValue('val-ratio', 0, state.metrics.ratio, 1000, true);
    document.getElementById('bar-ratio').style.width = state.metrics.ratio + '%';

    // Veredicto
    const verdict = document.getElementById('final-verdict');
    if (state.metrics.ratio > 75 && state.metrics.focus > 0.8) {
        verdict.innerText = "EXCELENTE";
        verdict.className = "text-xl font-bold text-neon-green";
    } else if (state.metrics.ratio > 50) {
        verdict.innerText = "MODERADO";
        verdict.className = "text-xl font-bold text-yellow-400";
    } else {
        verdict.innerText = "DILUIDO / RIESGO";
        verdict.className = "text-xl font-bold text-red-500";
    }

    // Resumen y Tags
    document.getElementById('ai-summary').innerText = state.summary;
    const tagCont = document.getElementById('topic-tags');
    tagCont.innerHTML = '';
    Object.keys(state.topics).forEach(t => {
        tagCont.innerHTML += `<span class="topic-badge border-gray-600 text-gray-400">${t}</span>`;
    });

    // Tabla
    const tbody = document.getElementById('results-table-body');
    tbody.innerHTML = '';
    state.vectors.sort((a,b) => b.sim - a.sim).forEach(v => {
        const statusColor = v.sim > 0.7 ? 'text-neon-green' : 'text-red-500';
        const html = `
            <tr class="border-b border-gray-800 hover:bg-white/5 transition-colors">
                <td class="py-2 pl-2 truncate max-w-[200px]" title="${v.url}">${v.url}</td>
                <td class="text-center text-gray-500 text-xs">${v.topic}</td>
                <td class="text-right font-mono text-white">${v.sim.toFixed(3)}</td>
                <td class="text-right pr-2 font-bold text-xs ${statusColor}">${v.sim > 0.7 ? 'PASS' : 'FAIL'}</td>
            </tr>
        `;
        tbody.insertAdjacentHTML('beforeend', html);
    });

    renderChart();
    resSection.scrollIntoView({ behavior: 'smooth' });
}

// --- 6. CHART VISUALIZATION ---

let chartInstance = null;

function renderChart() {
    const ctx = document.getElementById('scatterChart');
    if (!ctx) return;
    
    if (chartInstance) chartInstance.destroy();

    chartInstance = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'URLs',
                data: state.vectors,
                backgroundColor: c => {
                    const sim = c.raw?.sim;
                    if (sim > 0.8) return '#ffffff'; // Core
                    if (sim > 0.6) return '#00f3ff'; // Related
                    return '#ff007f'; // Outlier (Pink)
                },
                pointRadius: 5,
                pointHoverRadius: 8
            }, {
                label: 'Centroide',
                data: [{x:0, y:0}],
                pointStyle: 'crossRot',
                pointRadius: 10,
                borderColor: 'rgba(255,255,255,0.5)',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { display: false, min: -5, max: 5 },
                y: { display: false, min: -5, max: 5 }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (c) => c.datasetIndex === 0 ? `${c.raw.url} (${c.raw.sim.toFixed(2)})` : ''
                    }
                }
            }
        }
    });
}

// --- 7. EXPORT ---

function downloadExcelReport() {
    if (!state.domain || state.vectors.length === 0) return;
    
    const summaryData = [
        ["BrandRank AI Report"],
        ["Dominio", state.domain],
        ["Fecha", new Date().toLocaleDateString()],
        ["Site Focus", state.metrics.focus],
        ["Site Radius", state.metrics.radius],
        ["Site Ratio", state.metrics.ratio + "%"],
        ["Resumen", state.summary]
    ];

    const detailsData = [
        ["URL", "Topic", "Similarity", "Status"]
    ];
    state.vectors.forEach(v => {
        detailsData.push([v.url, v.topic, v.sim, v.sim > 0.7 ? "PASS" : "FAIL"]);
    });

    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
    const ws2 = XLSX.utils.aoa_to_sheet(detailsData);
    
    XLSX.utils.book_append_sheet(wb, ws1, "Resumen");
    XLSX.utils.book_append_sheet(wb, ws2, "URLs");
    
    XLSX.writeFile(wb, `${state.domain}_audit.xlsx`);
}

// --- 8. MOCKS (Fallback por si API falla en local) ---
// Solo se usan si pones state.isSimulating = true manualmente en código

function mockDiscovery(d) {
    return new Promise(r => setTimeout(() => {
        r([
            `https://${d}/`, 
            `https://${d}/about`, 
            `https://${d}/contact`,
            `https://${d}/blog/post-1`,
            `https://${d}/blog/post-2`
        ]);
    }, 1000));
}

function mockAnalysis(urls) {
    return new Promise(r => setTimeout(() => {
        r(urls.map(u => ({
            url: u,
            vector: Array(10).fill(0).map(()=>Math.random()),
            topic: 'Mock Topic',
            summary: 'Simulated content.'
        })));
    }, 1500));
}

// --- 9. INIT ---
log("Sistema inicializado. v1.0", 'info');

// Drag handle console logic (Opcional, misma que antes)
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