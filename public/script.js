// ESTADO GLOBAL
let state = {
    domain: '',
    urls: [],
    selectedUrls: [],
    vectors: [],
    metrics: { focus: 0, radius: 0, ratio: 0 },
    topics: {},
    summary: ''
};

// --- LOGGING & UI UTILS ---
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

    line.innerHTML = `<span class="opacity-50 select-none mr-3">[${time}]</span><span class="${color}">${message}</span>`;
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

// --- API CALLS ---

async function startDiscovery() {
    const input = document.getElementById('domainInput');
    const domain = input.value.trim();
    if (!domain) { log("Por favor, ingresa un dominio.", 'warn'); return; }

    state.domain = domain;
    resetUI();
    log(`Iniciando escaneo para: ${domain}`, 'process');
    
    try {
        const res = await fetch(`/api/search?domain=${domain}`);
        if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
        
        const data = await res.json();
        
        if (!data.success) throw new Error(data.error);
        
        const urls = data.urls || [];
        const source = data.source || 'Desconocido';
        
        state.urls = urls;
        
        if (urls.length === 0) {
            log("No se encontraron URLs (Ni sitemap ni Google).", 'error');
        } else {
            log(`ÉXITO: ${urls.length} URLs encontradas vía ${source}.`, 'info');
            renderUrlList();
        }

    } catch (e) {
        log(`Error Discovery: ${e.message}`, 'error');
    }
}

async function processUrlBatch(urls) {
    const results = [];
    let processed = 0;
    log(`Iniciando análisis profundo de ${urls.length} URLs...`, 'process');

    // Procesamos de 3 en 3 para no saturar
    const BATCH_SIZE = 3;
    
    for (let i = 0; i < urls.length; i += BATCH_SIZE) {
        const chunk = urls.slice(i, i + BATCH_SIZE);
        const promises = chunk.map(url => 
            fetch('/api/analyze', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ url })
            }).then(r => r.json())
        );

        const chunkResults = await Promise.all(promises);

        chunkResults.forEach(data => {
            if (data.success && data.data) {
                results.push(data.data);
                log(`Analyzed: ${data.data.url}`, 'data');
            } else {
                log(`Skip: ${data.error || 'Error desconocido'}`, 'warn');
            }
        });
        
        processed += chunk.length;
    }
    
    log(`Análisis completado. ${results.length} URLs procesadas correctamente.`, 'process');
    return results;
}

async function analyzeSelected() {
    const checked = Array.from(document.querySelectorAll('#url-list input:checked')).map(c => c.value);
    if (checked.length === 0) { alert("Selecciona al menos una URL"); return; }
    
    state.selectedUrls = checked;
    const selSection = document.getElementById('step-selection');
    if(selSection) selSection.classList.add('opacity-50', 'pointer-events-none');
    
    const rawData = await processUrlBatch(checked);
    
    if (rawData.length === 0) {
        log("Fallo crítico: No se obtuvieron datos de IA.", 'error');
        if(selSection) selSection.classList.remove('opacity-50', 'pointer-events-none');
        return;
    }

    processVectorsAndMetrics(rawData);
    renderResultsDashboard();
}

// --- MATH & POLAR LOGIC ---

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
    // 1. Calcular Centroide (La URL "Promedio Perfecta")
    const dim = rawData[0].vector.length;
    const centroid = new Array(dim).fill(0);
    
    rawData.forEach(item => { for(let i=0; i<dim; i++) centroid[i] += item.vector[i]; });
    for(let i=0; i<dim; i++) centroid[i] /= rawData.length;

    // 2. Transformación Polar a Cartesiana para el Gráfico
    state.vectors = rawData.map(item => {
        const sim = cosineSimilarity(item.vector, centroid);
        
        // RADIO (r): Cuanto más similar (1.0), más cerca del centro (0)
        // Multiplicamos por 3 para dar espacio visual
        const r = (1 - sim) * 3; 
        
        // ÁNGULO (theta): Aleatorio para distribuir como una galaxia
        const angle = Math.random() * Math.PI * 2;

        return {
            url: item.url, 
            sim: sim, 
            topic: item.topic || 'General',
            summary: item.summary,
            // Coordenadas para Chart.js
            x: r * Math.cos(angle), 
            y: r * Math.sin(angle)
        };
    });

    // 3. Métricas
    const sims = state.vectors.map(v => v.sim);
    const avgSim = sims.reduce((a,b) => a+b, 0) / sims.length;
    
    // Ratio: % de URLs con similitud decente (>0.65)
    const ratio = (state.vectors.filter(v => v.sim > 0.65).length / state.vectors.length) * 100;
    
    // Varianza (Radio de la nube)
    const variance = sims.reduce((a,b) => a + Math.pow(b - avgSim, 2), 0) / sims.length;
    const radius = Math.sqrt(variance);

    state.metrics = { 
        focus: parseFloat(avgSim.toFixed(3)), 
        radius: parseFloat(radius.toFixed(3)), 
        ratio: Math.round(ratio) 
    };
    
    // Top Topic
    state.topics = {};
    state.vectors.forEach(v => { state.topics[v.topic] = (state.topics[v.topic] || 0) + 1; });
    const topTopic = Object.entries(state.topics).sort((a,b) => b[1]-a[1])[0]?.[0] || 'Varios';
    
    state.summary = `Entidad: ${state.domain}\nFoco: ${topTopic}\nCoherencia: ${state.metrics.ratio}%`;
}

// --- UI RENDERING ---

function resetUI() {
    document.getElementById('step-selection').classList.add('hidden');
    document.getElementById('step-results').classList.add('hidden');
    const dl = document.getElementById('download-btn'); if(dl) dl.classList.add('hidden');
}

function renderUrlList() {
    const container = document.getElementById('url-list');
    if (!container) return;
    container.innerHTML = '';
    
    // Botón para seleccionar todo visible
    document.getElementById('step-selection').classList.remove('hidden', 'opacity-50', 'pointer-events-none');
    
    state.urls.forEach((url, i) => {
        // Marcamos las primeras 20 por defecto
        const isChecked = i < 20 ? 'checked' : '';
        const html = `
        <label class="flex items-center gap-3 p-2 hover:bg-white/5 cursor-pointer border-b border-gray-800/50 transition-colors">
            <input type="checkbox" value="${url}" ${isChecked} class="w-4 h-4 rounded border-gray-600 bg-transparent text-neon-pink focus:ring-0 focus:ring-offset-0">
            <span class="text-sm font-mono text-gray-400 truncate w-full hover:text-white">${url}</span>
        </label>`;
        container.insertAdjacentHTML('beforeend', html);
    });
    
    document.getElementById('step-selection').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function selectAll() { 
    const checkboxes = document.querySelectorAll('#url-list input');
    const allChecked = Array.from(checkboxes).every(c => c.checked);
    checkboxes.forEach(c => c.checked = !allChecked); 
}

function renderResultsDashboard() {
    const res = document.getElementById('step-results');
    res.classList.remove('hidden');
    const dl = document.getElementById('download-btn'); if(dl) dl.classList.remove('hidden');

    // Animar Métricas
    animateValue('val-focus', 0, state.metrics.focus, 1000);
    document.getElementById('bar-focus').style.width = (state.metrics.focus * 100) + '%';
    
    animateValue('val-radius', 0, state.metrics.radius, 1000);
    const radPct = Math.max(0, (1 - (state.metrics.radius * 2)) * 100); // Invertido: Menos radio es mejor
    document.getElementById('bar-radius').style.width = radPct + '%';
    
    animateValue('val-ratio', 0, state.metrics.ratio, 1000, true);
    document.getElementById('bar-ratio').style.width = state.metrics.ratio + '%';

    // Veredicto
    const verdict = document.getElementById('final-verdict');
    if (state.metrics.ratio > 80) { verdict.innerText = "AUTORIDAD"; verdict.className = "text-xl font-bold text-neon-green"; }
    else if (state.metrics.ratio > 50) { verdict.innerText = "MIXTO"; verdict.className = "text-xl font-bold text-yellow-400"; }
    else { verdict.innerText = "DILUIDO"; verdict.className = "text-xl font-bold text-red-500"; }

    // Resumen IA
    document.getElementById('ai-summary').innerText = state.summary;
    const tagCont = document.getElementById('topic-tags'); tagCont.innerHTML = '';
    Object.keys(state.topics).forEach(t => tagCont.innerHTML += `<span class="topic-badge border-gray-600 text-gray-400 hover:border-neon-pink hover:text-white transition-colors cursor-default">${t}</span>`);

    // Tabla
    const tbody = document.getElementById('results-table-body'); tbody.innerHTML = '';
    state.vectors.sort((a,b) => b.sim - a.sim).forEach(v => {
        const statusClass = v.sim > 0.7 ? 'text-neon-green' : (v.sim > 0.5 ? 'text-yellow-400' : 'text-red-500');
        const statusText = v.sim > 0.7 ? 'PASS' : 'WARN';
        
        tbody.innerHTML += `
        <tr class="border-b border-gray-800 hover:bg-white/5 transition-colors">
            <td class="py-3 pl-2 truncate max-w-[250px]" title="${v.url}">
                <a href="${v.url}" target="_blank" class="text-gray-400 hover:text-neon-pink transition-colors">${v.url.replace(state.domain, '')}</a>
            </td>
            <td class="text-center text-gray-500 text-xs uppercase tracking-wide">${v.topic}</td>
            <td class="text-right font-mono text-white">${v.sim.toFixed(3)}</td>
            <td class="text-right pr-2 font-bold text-xs ${statusClass}">${statusText}</td>
        </tr>`;
    });

    renderChart();
    res.scrollIntoView({ behavior: 'smooth' });
}

// --- CHART JS (CONFIGURACIÓN POLAR/GALAXIA) ---
let chartInstance = null;

function renderChart() {
    const ctx = document.getElementById('scatterChart');
    if (!ctx) return;
    if (chartInstance) chartInstance.destroy();

    // Colores dinámicos
    const pointColors = state.vectors.map(v => {
        if (v.sim > 0.8) return '#00ff9d'; // Verde Neón
        if (v.sim > 0.6) return '#00f3ff'; // Azul Neón
        return '#ff0055'; // Rojo Neón
    });

    chartInstance = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [
                {
                    label: 'URLs',
                    data: state.vectors, // Usa x, y calculados antes
                    backgroundColor: pointColors,
                    pointRadius: 6,
                    pointHoverRadius: 12,
                    pointBorderColor: 'rgba(0,0,0,0.5)',
                    pointBorderWidth: 1
                },
                {
                    label: 'Centro (Entidad Ideal)',
                    data: [{x:0, y:0}],
                    pointRadius: 15,
                    pointStyle: 'crossRot',
                    borderColor: 'white',
                    borderWidth: 2,
                    backgroundColor: 'rgba(255,255,255,0.1)'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { display: false, min: -2.5, max: 2.5 }, // Fijo para mantener el centro
                y: { display: false, min: -2.5, max: 2.5 }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(10,10,10, 0.9)',
                    titleColor: '#fff',
                    borderColor: '#333',
                    borderWidth: 1,
                    callbacks: {
                        label: (ctx) => {
                            const p = ctx.raw;
                            return p.x === 0 ? 'Centro Ideal' : `${p.topic}: ${(p.sim*100).toFixed(1)}% Similitud`;
                        }
                    }
                }
            }
        }
    });
}

// --- EXPORTAR EXCEL ---
function downloadExcelReport() {
    if (!state.domain || !window.XLSX) return;
    
    // Hoja 1: Resumen
    const summaryData = [
        ["Reporte BrandRank AI"],
        ["Dominio", state.domain],
        ["Fecha", new Date().toLocaleDateString()],
        ["URLs Analizadas", state.vectors.length],
        [],
        ["METRICAS"],
        ["Entity Focus", state.metrics.focus],
        ["Semantic Ratio", state.metrics.ratio + "%"],
        ["Dispersion (Radius)", state.metrics.radius]
    ];
    
    // Hoja 2: Datos
    const detailHeader = ["URL", "Topic", "Summary", "Similarity Score", "Status"];
    const detailData = state.vectors.map(v => [
        v.url, 
        v.topic, 
        v.summary, 
        v.sim, 
        v.sim > 0.7 ? "PASS" : "FAIL"
    ]);

    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.aoa_to_sheet(summaryData);
    const ws2 = XLSX.utils.aoa_to_sheet([detailHeader, ...detailData]);

    XLSX.utils.book_append_sheet(wb, ws1, "Resumen");
    XLSX.utils.book_append_sheet(wb, ws2, "Detalle URLs");
    
    XLSX.writeFile(wb, `${state.domain.replace('.','_')}_audit.xlsx`);
}

// --- DRAG HANDLE (Consola) ---
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