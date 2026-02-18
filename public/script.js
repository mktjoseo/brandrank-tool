// VARIABLES GLOBALES
let discoveredUrls = []; // URLs encontradas por la búsqueda
let state = {
    vectors: [],
    centroid: null,
    isAnalyzing: false
};

// ELEMENTOS DEL DOM
const dom = {
    input: document.getElementById('domain-input'),
    btnSearch: document.getElementById('search-btn'),
    areaSelection: document.getElementById('selection-area'),
    listContainer: document.getElementById('url-list'),
    manualInput: document.getElementById('manual-urls'),
    btnToggle: document.getElementById('toggle-all-btn'),
    btnStart: document.getElementById('start-btn'),
    console: document.getElementById('console-output'),
    table: document.getElementById('results-table-body')
};

// ==========================================
// 1. FASE DE BÚSQUEDA Y SELECCIÓN
// ==========================================

// Escuchar tecla ENTER en el input
dom.input.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleSearch();
});

dom.btnSearch.addEventListener('click', handleSearch);

async function handleSearch() {
    const domain = dom.input.value.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!domain) return log("Escribe un dominio válido.", "error");

    log(`Buscando URLs para: ${domain}...`, "process");
    dom.areaSelection.classList.add('hidden');
    dom.btnStart.disabled = true;
    dom.btnStart.className = "w-full py-4 bg-gray-800 text-gray-500 font-bold rounded cursor-not-allowed transition flex items-center justify-center gap-2";

    try {
        // Llamamos a la API de búsqueda (search.js)
        const res = await fetch(`/api/search?domain=${domain}`);
        if (!res.ok) throw new Error("Error conectando con API de búsqueda");
        
        const urls = await res.json();
        discoveredUrls = urls || [];

        if (discoveredUrls.length === 0) {
            log("No se encontraron URLs automáticas. Puedes añadir manuales.", "warn");
        } else {
            log(`Encontradas ${discoveredUrls.length} URLs.`, "success");
        }

        renderSelectionList();
        dom.areaSelection.classList.remove('hidden');
        enableStartButton();

    } catch (e) {
        log(e.message, "error");
    }
}

// Renderizar checkboxes
function renderSelectionList() {
    dom.listContainer.innerHTML = '';
    
    discoveredUrls.forEach(url => {
        const div = document.createElement('div');
        div.className = "flex items-center gap-2 hover:bg-white/5 p-1 rounded cursor-pointer";
        div.innerHTML = `
            <input type="checkbox" value="${url}" checked class="url-checkbox accent-green-500 cursor-pointer">
            <span class="truncate" title="${url}">${url.replace(/^https?:\/\//, '')}</span>
        `;
        // Click en el texto también marca el checkbox
        div.addEventListener('click', (e) => {
            if (e.target.type !== 'checkbox') {
                const cb = div.querySelector('input');
                cb.checked = !cb.checked;
            }
        });
        dom.listContainer.appendChild(div);
    });
}

// Toggle Select All / Deselect All
let allSelected = true;
dom.btnToggle.addEventListener('click', () => {
    const checkboxes = document.querySelectorAll('.url-checkbox');
    allSelected = !allSelected;
    checkboxes.forEach(cb => cb.checked = allSelected);
    dom.btnToggle.innerText = allSelected ? "Deselect All" : "Select All";
});

// Habilitar botón Start
function enableStartButton() {
    dom.btnStart.disabled = false;
    dom.btnStart.innerHTML = `<i class="ph-fill ph-play"></i> INICIAR AUDITORÍA`;
    dom.btnStart.className = "w-full py-4 bg-green-600 hover:bg-green-500 text-white font-bold rounded shadow-lg shadow-green-900/20 transition flex items-center justify-center gap-2";
}

// ==========================================
// 2. FASE DE ANÁLISIS (Batching)
// ==========================================

dom.btnStart.addEventListener('click', async () => {
    // Recopilar URLs seleccionadas
    const checkboxes = document.querySelectorAll('.url-checkbox:checked');
    const manualText = dom.manualInput.value.trim();
    
    let finalUrls = Array.from(checkboxes).map(cb => cb.value);
    
    // Añadir manuales
    if (manualText) {
        const manuals = manualText.split('\n').map(u => u.trim()).filter(u => u.startsWith('http'));
        finalUrls = [...finalUrls, ...manuals];
    }

    // Eliminar duplicados
    finalUrls = [...new Set(finalUrls)];

    if (finalUrls.length === 0) return log("Selecciona al menos 1 URL", "error");

    // UI Reset
    state = { vectors: [], centroid: null, isAnalyzing: true };
    dom.table.innerHTML = '';
    dom.btnStart.disabled = true;
    dom.btnStart.innerText = "Analizando...";
    updateChart([]);
    
    log(`Iniciando análisis de ${finalUrls.length} URLs...`, "process");

    // Procesar en lotes de 2 para ser muy seguros con la API gratuita
    const BATCH_SIZE = 2; 
    
    for (let i = 0; i < finalUrls.length; i += BATCH_SIZE) {
        const batch = finalUrls.slice(i, i + BATCH_SIZE);
        log(`Procesando lote ${Math.floor(i/BATCH_SIZE)+1}...`, "info");
        
        await Promise.all(batch.map(processSingleUrl));
        
        // Pausa de seguridad
        await new Promise(r => setTimeout(r, 1500)); 

        // Recalcular métricas en tiempo real
        if (state.vectors.length > 0) {
            calculateMetrics();
        }
    }

    dom.btnStart.disabled = false;
    dom.btnStart.innerText = "AUDITORÍA COMPLETADA";
    log("Proceso finalizado.", "success");
});

async function processSingleUrl(url) {
    try {
        const res = await fetch('/api/analyze', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
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
            addRowToTable(item);
            log(`OK: ${url.substring(0, 30)}...`, "success");
        } else {
            log(`Error: ${data.error || 'Desconocido'} (${url})`, "error");
        }
    } catch (e) {
        log(`Fallo red: ${url}`, "error");
    }
}

// ==========================================
// 3. MATEMÁTICAS Y VISUALIZACIÓN
// ==========================================

function calculateMetrics() {
    // 1. Centroide
    const dim = state.vectors[0].vector.length;
    let sum = new Array(dim).fill(0);
    state.vectors.forEach(v => v.vector.forEach((val, k) => sum[k] += val));
    state.centroid = sum.map(val => val / state.vectors.length);

    // 2. Similitudes
    state.vectors.forEach(v => {
        v.sim = cosineSimilarity(v.vector, state.centroid);
    });

    // 3. Ratios
    const passed = state.vectors.filter(v => v.sim > 0.7).length;
    const siteRatio = (passed / state.vectors.length) * 100;
    
    // Focus (Top 25%)
    const sorted = [...state.vectors].sort((a,b) => b.sim - a.sim);
    const topN = Math.ceil(state.vectors.length * 0.25);
    const focusAvg = sorted.slice(0, topN).reduce((acc, c) => acc + c.sim, 0) / topN;

    // UI Updates
    document.getElementById('metric-ratio').innerText = siteRatio.toFixed(0) + "%";
    document.getElementById('metric-focus').innerText = (focusAvg * 100).toFixed(0) + "%";
    
    updateTableScores();
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

// UI Helpers
function log(msg, type) {
    const div = document.createElement('div');
    div.innerText = `> ${msg}`;
    div.className = type === 'error' ? 'text-red-500' : (type === 'success' ? 'text-green-400' : 'text-gray-400');
    dom.console.appendChild(div);
    dom.console.scrollTop = dom.console.scrollHeight;
}

function addRowToTable(item) {
    const row = document.createElement('div');
    row.id = `row-${state.vectors.length-1}`;
    row.className = "flex items-center border-b border-gray-800 py-2";
    row.innerHTML = `
        <div class="w-1/2 truncate pr-2 text-gray-300" title="${item.url}">${item.url.replace(/^https?:\/\//,'')}</div>
        <div class="w-1/4 text-gray-500 text-xs truncate">${item.topic}</div>
        <div class="w-1/4 text-right font-mono text-gray-400 sim-score">...</div>
    `;
    dom.table.appendChild(row);
}

function updateTableScores() {
    state.vectors.forEach((v, idx) => {
        const row = document.getElementById(`row-${idx}`);
        if(row) {
            const scoreDiv = row.querySelector('.sim-score');
            const score = (v.sim * 100).toFixed(1);
            scoreDiv.innerText = `${score}%`;
            scoreDiv.className = `w-1/4 text-right font-mono ${v.sim > 0.7 ? 'text-green-400' : 'text-red-400'}`;
        }
    });
}

// ChartJS Setup
let chartInstance = null;
function updateChart(data) {
    const ctx = document.getElementById('topicalGraph');
    const points = data.map(d => ({
        x: d.sim,
        y: Math.random() * 0.8 + 0.1 // Random Y para separar puntos
    }));

    if (chartInstance) {
        chartInstance.data.datasets[0].data = points;
        chartInstance.update();
    } else {
        chartInstance = new Chart(ctx, {
            type: 'scatter',
            data: {
                datasets: [{
                    label: 'URL',
                    data: points,
                    backgroundColor: ctx => (ctx.raw?.x > 0.7 ? '#4ade80' : '#f87171'),
                    pointRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { min: 0, max: 1.1, grid: {color: '#222'} },
                    y: { display: false, min: 0, max: 1 }
                },
                plugins: { legend: {display: false} }
            }
        });
    }
}