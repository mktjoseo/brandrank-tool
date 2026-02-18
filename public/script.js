// CONFIGURACIÓN
let state = {
    domain: '',
    urls: [],
    vectors: [],
    centroid: null
};

// Referencias al DOM (Tu diseño original)
const UI = {
    input: document.getElementById('domain-input'),
    btnStart: document.getElementById('start-btn'),
    console: document.getElementById('console-output'),
    table: document.getElementById('results-table-body'),
    focusMetric: document.getElementById('metric-focus'),
    ratioMetric: document.getElementById('metric-ratio')
};

// Logger adaptado a tu consola
function log(msg, type = 'info') {
    if (!UI.console) return;
    const div = document.createElement('div');
    const time = new Date().toLocaleTimeString('es-ES', { hour12: false });
    
    let color = 'text-green-400';
    if (type === 'error') color = 'text-red-500 font-bold';
    if (type === 'warn') color = 'text-yellow-400';
    
    div.innerHTML = `<span class="opacity-50 mr-2">[${time}]</span><span class="${color}">${msg}</span>`;
    div.className = "mb-1 border-b border-gray-900/50 pb-1";
    
    UI.console.appendChild(div);
    UI.console.scrollTop = UI.console.scrollHeight;
}

// BOTÓN DE INICIO
if (UI.btnStart) {
    UI.btnStart.addEventListener('click', startAudit);
}

async function startAudit() {
    const domain = UI.input.value.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!domain) return log("Introduce un dominio válido", "error");

    // Reset
    state.domain = domain;
    state.vectors = [];
    state.urls = [];
    state.centroid = null;
    UI.table.innerHTML = '';
    updateChart([]);

    UI.btnStart.disabled = true;
    UI.btnStart.innerText = "AUDITANDO...";

    try {
        // 1. BUSCAR URLS
        log(`🔎 Escaneando Google para: ${domain}...`);
        const res = await fetch(`/api/search?domain=${domain}`);
        if (!res.ok) throw new Error("Error conectando con API de búsqueda");
        
        const urls = await res.json();
        
        if (!urls || urls.length === 0) {
            throw new Error("Google no encontró URLs indexadas. Intenta otro dominio.");
        }

        log(`✅ Encontradas ${urls.length} URLs. Iniciando análisis...`);
        state.urls = urls;

        // 2. PROCESAR EN LOTES (Batching)
        // Procesamos de 3 en 3 para velocidad y estabilidad
        const BATCH_SIZE = 3;
        for (let i = 0; i < urls.length; i += BATCH_SIZE) {
            const batch = urls.slice(i, i + BATCH_SIZE);
            log(`⚙ Procesando bloque ${Math.floor(i/BATCH_SIZE)+1} (${batch.length} URLs)...`);
            
            await Promise.all(batch.map(analyzeUrl));
            
            // Recalcular métricas tras cada bloque
            if (state.vectors.length > 0) calculateMetrics();
            
            // Pausa técnica
            await new Promise(r => setTimeout(r, 1000));
        }

        log("🚀 Auditoría Finalizada.", "success");

    } catch (e) {
        log(e.message, "error");
    } finally {
        UI.btnStart.disabled = false;
        UI.btnStart.innerText = "INICIAR AUDITORÍA";
    }
}

async function analyzeUrl(url) {
    try {
        const res = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        const data = await res.json();

        if (data.success) {
            const item = {
                url: data.data.url,
                topic: data.data.topic,
                vector: data.data.vector,
                sim: 0
            };
            state.vectors.push(item);
            addTableResult(item);
            log(`  > Analizado: ${cleanUrl(url)}`);
        } else {
            log(`  X Fallo en: ${cleanUrl(url)}`, "warn");
        }
    } catch (e) {
        log(`  X Error red: ${cleanUrl(url)}`, "error");
    }
}

// UI Y CÁLCULOS
function addTableResult(item) {
    const row = document.createElement('tr');
    row.className = "hover:bg-white/5 transition border-b border-gray-800";
    row.innerHTML = `
        <td class="p-3 pl-6 truncate max-w-[200px]" title="${item.url}">${cleanUrl(item.url)}</td>
        <td class="p-3 text-gray-400 text-xs">${item.topic}</td>
        <td class="p-3 font-mono text-xs sim-score">...</td>
        <td class="p-3"><span class="text-xs px-2 py-1 rounded bg-gray-800">WAIT</span></td>
    `;
    UI.table.appendChild(row);
}

function calculateMetrics() {
    // 1. Centroide
    const dim = state.vectors[0].vector.length;
    let sum = new Array(dim).fill(0);
    state.vectors.forEach(v => v.vector.forEach((val, k) => sum[k] += val));
    state.centroid = sum.map(val => val / state.vectors.length);

    // 2. Similitud Coseno
    state.vectors.forEach(v => {
        v.sim = cosineSimilarity(v.vector, state.centroid);
    });

    // 3. Actualizar UI Tabla
    const rows = Array.from(UI.table.children);
    state.vectors.forEach((v, i) => {
        if (rows[i]) {
            const score = (v.sim * 100).toFixed(1);
            const isPass = v.sim >= 0.7;
            const color = isPass ? 'text-green-400' : 'text-red-400';
            
            rows[i].querySelector('.sim-score').innerHTML = `<span class="${color}">${score}%</span>`;
            rows[i].lastElementChild.innerHTML = isPass 
                ? `<span class="text-green-400 bg-green-900/20 px-2 py-1 rounded text-xs">PASS</span>`
                : `<span class="text-red-400 bg-red-900/20 px-2 py-1 rounded text-xs">FAIL</span>`;
        }
    });

    // 4. Métricas Globales
    const passed = state.vectors.filter(v => v.sim >= 0.7).length;
    const siteRatio = (passed / state.vectors.length) * 100;

    // Focus Ratio (Top 25%)
    const sorted = [...state.vectors].sort((a,b) => b.sim - a.sim);
    const topN = Math.max(1, Math.ceil(state.vectors.length * 0.25));
    const focusAvg = sorted.slice(0, topN).reduce((acc, c) => acc + c.sim, 0) / topN;

    UI.ratioMetric.innerText = siteRatio.toFixed(0) + "%";
    UI.focusMetric.innerText = (focusAvg * 100).toFixed(0) + "%";

    updateChart(state.vectors);
}

function cosineSimilarity(a, b) {
    let dot = 0, mA = 0, mB = 0;
    for(let i=0; i<a.length; i++) {
        dot += a[i]*b[i];
        mA += a[i]*a[i];
        mB += b[i]*b[i];
    }
    return dot / (Math.sqrt(mA) * Math.sqrt(mB));
}

function cleanUrl(url) {
    return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
}

// ChartJS
let chartInstance = null;
function updateChart(data) {
    const ctx = document.getElementById('topicalGraph');
    if (!ctx) return;

    const points = data.map(d => ({
        x: d.sim,
        y: Math.random() * 0.5 + 0.25 // Centrado
    }));

    if (chartInstance) {
        chartInstance.data.datasets[0].data = points;
        chartInstance.update();
    } else {
        chartInstance = new Chart(ctx, {
            type: 'scatter',
            data: {
                datasets: [{
                    label: 'Pages',
                    data: points,
                    backgroundColor: c => (c.raw?.x >= 0.7 ? '#00ffff' : '#ff00ff'), // Colores Neon originales
                    pointRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { min: 0, max: 1.1, grid: { color: '#222' } },
                    y: { display: false, min: 0, max: 1 }
                },
                plugins: { legend: { display: false } }
            }
        });
    }
}