let state = {
    domain: '',
    urls: [],
    vectors: [],
    metrics: { focus: 0, radius: 0, ratio: 0 },
    topics: {}
};

// --- LOGGING SYSTEM ---
const consoleOutput = document.getElementById('console-output');
function log(msg, type = 'info') {
    if (!consoleOutput) return;
    const color = type === 'error' ? 'text-red-500' : (type === 'process' ? 'text-neon-pink' : (type === 'data' ? 'text-gray-500' : 'text-green-400'));
    const time = new Date().toLocaleTimeString('es-ES', {hour12:false});
    consoleOutput.innerHTML += `<div class="mb-1 border-b border-gray-900/50 pb-1"><span class="opacity-40 text-xs mr-2">[${time}]</span><span class="${color} font-mono text-sm">${msg}</span></div>`;
    document.getElementById('terminal-body').scrollTop = document.getElementById('terminal-body').scrollHeight;
}

// --- DISCOVERY ---
async function startDiscovery() {
    const input = document.getElementById('domainInput');
    const domain = input.value.trim();
    if (!domain) return alert("Escribe un dominio");
    
    state.domain = domain;
    // Limpiamos UI
    document.getElementById('url-list').innerHTML = '';
    document.getElementById('step-selection').classList.add('hidden');
    document.getElementById('step-results').classList.add('hidden');
    
    log(`🚀 Iniciando escaneo de ${domain}...`, 'process');
    
    try {
        const res = await fetch(`/api/search?domain=${domain}`);
        const data = await res.json();
        
        // Mostrar logs del servidor
        if (data.debugLogs) data.debugLogs.forEach(l => log(`SERVER: ${l}`, 'data'));

        if (!data.success) throw new Error(data.error);
        
        state.urls = data.urls || [];
        log(`✅ Se encontraron ${state.urls.length} URLs válidas.`, 'process');
        renderUrlList();

    } catch (e) {
        log(`❌ Error Crítico: ${e.message}`, 'error');
    }
}

function renderUrlList() {
    const list = document.getElementById('url-list');
    list.innerHTML = '';
    document.getElementById('step-selection').classList.remove('hidden');
    
    state.urls.forEach((url, i) => {
        const checked = i < 20 ? 'checked' : '';
        list.innerHTML += `
        <label class="flex items-center gap-3 p-2 hover:bg-white/5 border-b border-gray-800 transition-colors cursor-pointer">
            <input type="checkbox" value="${url}" ${checked} class="accent-neon-pink w-4 h-4">
            <span class="text-xs font-mono text-gray-300 truncate hover:text-white">${url}</span>
        </label>`;
    });
    document.getElementById('step-selection').scrollIntoView({behavior:'smooth', block:'center'});
}

function selectAll() {
    const inputs = document.querySelectorAll('#url-list input');
    const all = Array.from(inputs).every(i => i.checked);
    inputs.forEach(i => i.checked = !all);
}

// --- ANALYZE ---
async function analyzeSelected() {
    const urls = Array.from(document.querySelectorAll('#url-list input:checked')).map(c => c.value);
    if (urls.length === 0) return alert("Selecciona URLs");
    
    log(`🧠 Iniciando análisis semántico de ${urls.length} URLs...`, 'process');
    
    const results = [];
    const BATCH_SIZE = 3; // Lotes pequeños para no saturar

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
            if (data.success) {
                results.push(data.data);
                // Muestra un extracto de lo que leyó la IA
                const snippet = data.data.debug_text.substring(0, 100).replace(/\n/g, ' ');
                log(`📄 LEÍDO [${data.data.url.split('/').pop()}]: ${snippet}...`, 'data');
            } else {
                log(`⚠️ Fallo: ${data.error}`, 'error');
            }
        });
    }

    if (results.length > 0) {
        processMetrics(results);
        renderDashboard();
    } else {
        log("❌ No se pudo analizar ninguna URL.", 'error');
    }
}

// --- MATH & VISUALS ---
function processMetrics(data) {
    const dim = data[0].vector.length;
    
    // 1. Centroide
    const centroid = new Array(dim).fill(0);
    data.forEach(d => d.vector.forEach((v, i) => centroid[i] += v));
    centroid.forEach((v, i) => centroid[i] /= data.length);

    // 2. Coordenadas y Similitud
    state.vectors = data.map(d => {
        let dot = 0, mA = 0, mB = 0;
        for (let i = 0; i < dim; i++) {
            dot += d.vector[i] * centroid[i];
            mA += d.vector[i] ** 2;
            mB += centroid[i] ** 2;
        }
        const sim = dot / (Math.sqrt(mA) * Math.sqrt(mB));
        
        // Lógica Polar para Gráfico Galáctico
        const r = (1 - sim) * 4; // Radio (inverso a similitud)
        const angle = Math.random() * Math.PI * 2; // Ángulo aleatorio

        return {
            ...d,
            sim,
            x: r * Math.cos(angle),
            y: r * Math.sin(angle)
        };
    });

    // 3. Métricas Generales
    const sims = state.vectors.map(v => v.sim);
    const avg = sims.reduce((a,b) => a+b, 0) / sims.length;
    state.metrics.focus = avg.toFixed(3);
    state.metrics.ratio = Math.round((sims.filter(s => s > 0.65).length / sims.length) * 100);
    
    // Radius (Varianza)
    const variance = sims.reduce((a,b) => a + Math.pow(b - avg, 2), 0) / sims.length;
    state.metrics.radius = Math.sqrt(variance).toFixed(3);

    // Top Topic
    state.topics = {};
    state.vectors.forEach(v => state.topics[v.topic] = (state.topics[v.topic]||0)+1);
}

function renderDashboard() {
    const res = document.getElementById('step-results');
    res.classList.remove('hidden');
    document.getElementById('download-btn').classList.remove('hidden');

    // Update KPIs
    document.getElementById('val-focus').innerText = state.metrics.focus;
    document.getElementById('val-ratio').innerText = state.metrics.ratio + '%';
    document.getElementById('val-radius').innerText = state.metrics.radius;
    document.getElementById('bar-focus').style.width = (state.metrics.focus * 100) + '%';
    document.getElementById('bar-ratio').style.width = state.metrics.ratio + '%';

    // Summary Text
    const topTopic = Object.keys(state.topics).sort((a,b) => state.topics[b]-state.topics[a])[0] || 'Varios';
    document.getElementById('ai-summary').innerText = `Dominio: ${state.domain}\nTema Principal: ${topTopic}\nCoherencia Semántica: ${state.metrics.ratio}%`;

    // Table
    const tbody = document.getElementById('results-table-body');
    tbody.innerHTML = '';
    state.vectors.sort((a,b) => b.sim - a.sim).forEach(v => {
        const color = v.sim > 0.7 ? 'text-neon-green' : (v.sim > 0.5 ? 'text-yellow-400' : 'text-red-500');
        const status = v.sim > 0.7 ? 'PASS' : 'WARN';
        tbody.innerHTML += `
        <tr class="border-b border-gray-800 hover:bg-white/5 transition-colors">
            <td class="p-3 pl-2 truncate max-w-[200px]" title="${v.url}">
                <a href="${v.url}" target="_blank" class="text-gray-400 hover:text-white">${v.url.replace(state.domain,'')}</a>
            </td>
            <td class="text-center text-xs uppercase tracking-wider text-gray-500">${v.topic}</td>
            <td class="text-right font-mono text-white">${v.sim.toFixed(3)}</td>
            <td class="text-right pr-2 font-bold text-xs ${color}">${status}</td>
        </tr>`;
    });

    renderChart();
    res.scrollIntoView({behavior:'smooth'});
}

// --- CHART JS (GALAXY MODE) ---
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
                label: 'URLs',
                data: state.vectors,
                backgroundColor: colors,
                pointRadius: 6,
                pointHoverRadius: 10,
                pointBorderColor: 'rgba(0,0,0,0.5)',
                pointBorderWidth: 1
            }, {
                label: 'Centro Ideal',
                data: [{x:0, y:0}],
                pointRadius: 15,
                pointStyle: 'crossRot',
                borderColor: 'white',
                borderWidth: 2,
                backgroundColor: 'rgba(255,255,255,0.1)'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: { x: {display:false, min:-3, max:3}, y: {display:false, min:-3, max:3} },
            plugins: {
                legend: {display:false},
                tooltip: {
                    backgroundColor: 'rgba(0,0,0,0.9)',
                    titleColor: '#fff',
                    callbacks: {
                        label: (ctx) => {
                            const p = ctx.raw;
                            return p.x===0 ? 'Centro' : `${p.topic}: ${(p.sim*100).toFixed(1)}%`;
                        }
                    }
                }
            }
        }
    });
}

// --- EXCEL EXPORT ---
function downloadExcelReport() {
    if (!state.domain || !window.XLSX) return;
    const ws1 = XLSX.utils.aoa_to_sheet([["BrandRank Report"], ["Dominio", state.domain], ["Focus", state.metrics.focus], ["Ratio", state.metrics.ratio+"%"]]);
    const ws2 = XLSX.utils.aoa_to_sheet([["URL","Topic","Sim","Status"], ...state.vectors.map(v => [v.url, v.topic, v.sim, v.sim>0.7?"PASS":"FAIL"])]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, "Resumen");
    XLSX.utils.book_append_sheet(wb, ws2, "Detalle");
    XLSX.writeFile(wb, `${state.domain.replace('.','_')}_audit.xlsx`);
}

// Console Drag
const handle = document.getElementById('drag-handle');
const footer = document.getElementById('console-footer');
if(handle && footer) {
    let isDragging = false, startY, startHeight;
    handle.addEventListener('mousedown', (e) => { 
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