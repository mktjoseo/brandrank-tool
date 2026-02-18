// ==========================================
// CONFIGURACIÓN & ESTADO
// ==========================================
let state = {
    discoveredUrls: [],
    vectors: [],
    centroid: null,
    isAnalyzing: false
};

const UI = {
    input: document.getElementById('domain-input'),
    btnSearch: document.getElementById('search-btn'),
    areaSelection: document.getElementById('selection-area'),
    listContainer: document.getElementById('url-list'),
    manualInput: document.getElementById('manual-urls'),
    btnToggle: document.getElementById('toggle-all-btn'),
    btnStart: document.getElementById('start-btn'),
    terminal: document.getElementById('terminal-body'), // Tu footer original
    table: document.getElementById('results-table-body'),
    countLabel: document.getElementById('url-count')
};

// ==========================================
// LOGGER (Escribe en tu footer estilo terminal)
// ==========================================
function log(msg, type = 'info') {
    if (!UI.terminal) return;
    
    const div = document.createElement('div');
    const time = new Date().toLocaleTimeString('es-ES', { hour12: false });
    
    // Estilos según tipo de mensaje
    let color = 'text-gray-400';
    let prefix = '➜';
    
    if (type === 'error') { color = 'text-red-500 font-bold'; prefix = '✖'; }
    if (type === 'success') { color = 'text-green-400'; prefix = '✔'; }
    if (type === 'process') { color = 'text-blue-400'; prefix = '⚙'; }
    if (type === 'warn') { color = 'text-yellow-500'; prefix = '⚠'; }

    div.className = "mb-1 border-l-2 border-transparent pl-2 hover:border-gray-700 transition-colors";
    div.innerHTML = `
        <span class="opacity-30 text-[10px] mr-2 font-normal">[${time}]</span>
        <span class="${color}">${prefix} ${msg}</span>
    `;
    
    UI.terminal.appendChild(div);
    UI.terminal.scrollTop = UI.terminal.scrollHeight;
}

// ==========================================
// 1. FASE DE BÚSQUEDA
// ==========================================

// Evento Enter y Click
UI.input.addEventListener('keypress', (e) => { if (e.key === 'Enter') handleSearch(); });
UI.btnSearch.addEventListener('click', handleSearch);

async function handleSearch() {
    const domain = UI.input.value.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!domain) return log("Error: Ingresa un dominio válido.", "error");

    log(`Iniciando escaneo de sitemap/index para: ${domain}`, "process");
    
    // UI Loading state
    UI.btnSearch.innerHTML = `<i class="ph ph-spinner animate-spin"></i>`;
    
    try {
        const res = await fetch(`/api/search?domain=${domain}`);
        if (!res.ok) throw new Error("Error de conexión con la API de búsqueda.");
        
        const urls = await res.json();
        state.discoveredUrls = urls || [];

        if (state.discoveredUrls.length === 0) {
            log("Google no devolvió resultados indexados. Usa el modo manual.", "warn");
        } else {
            log(`Éxito: ${state.discoveredUrls.length} URLs encontradas.`, "success");
        }

        renderSelectionList();
        
        // Mostrar área de selección con animación
        UI.areaSelection.classList.remove('hidden');
        enableStartButton();

    } catch (e) {
        log(e.message, "error");
    } finally {
        UI.btnSearch.innerHTML = `<i class="ph-bold ph-magnifying-glass"></i>`;
    }
}

function renderSelectionList() {
    UI.listContainer.innerHTML = '';
    state.discoveredUrls.forEach(url => {
        const div = document.createElement('label');
        div.className = "flex items-center gap-3 p-2 rounded hover:bg-white/5 cursor-pointer text-xs font-mono text-gray-400 transition group";
        div.innerHTML = `
            <input type="checkbox" value="${url}" checked class="url-checkbox accent-green-500 w-4 h-4 rounded border-gray-700 bg-[#0a0a0a]">
            <span class="truncate group-hover:text-white transition">${url.replace(/^https?:\/\//, '')}</span>
        `;
        UI.listContainer.appendChild(div);
    });
    updateCount();
    
    // Listener para actualizar contador al hacer click en checkbox
    document.querySelectorAll('.url-checkbox').forEach(cb => {
        cb.addEventListener('change', updateCount);
    });
}

function updateCount() {
    const checked = document.querySelectorAll('.url-checkbox:checked').length;
    UI.countLabel.innerText = checked;
}

// Toggle Select All
let allSelected = true;
UI.btnToggle.addEventListener('click', () => {
    const checkboxes = document.querySelectorAll('.url-checkbox');
    allSelected = !allSelected;
    checkboxes.forEach(cb => cb.checked = allSelected);
    UI.btnToggle.innerText = allSelected ? "DESELECT ALL" : "SELECT ALL";
    updateCount();
});

function enableStartButton() {
    UI.btnStart.disabled = false;
    UI.btnStart.innerHTML = `<i class="ph-fill ph-play"></i> INICIAR AUDITORÍA`;
    UI.btnStart.className = "w-full py-4 bg-green-600 hover:bg-green-500 text-black font-bold rounded shadow-[0_0_20px_rgba(74,222,128,0.2)] transition flex items-center justify-center gap-2 tracking-wide text-sm";
}

// ==========================================
// 2. FASE DE ANÁLISIS (Batching)
// ==========================================

UI.btnStart.addEventListener('click', async () => {
    // Recopilar URLs
    const checkboxes = document.querySelectorAll('.url-checkbox:checked');
    const manualText = UI.manualInput.value.trim();
    let finalUrls = Array.from(checkboxes).map(cb => cb.value);
    
    if (manualText) {
        const manuals = manualText.split('\n').map(u => u.trim()).filter(u => u.length > 5);
        finalUrls = [...finalUrls, ...manuals];
    }
    finalUrls = [...new Set(finalUrls)]; // Eliminar duplicados

    if (finalUrls.length === 0) return log("Selecciona al menos 1 URL para comenzar.", "error");

    // UI Reset
    state.vectors = [];
    state.centroid = null;
    state.isAnalyzing = true;
    UI.table.innerHTML = '';
    UI.btnStart.disabled = true;
    UI.btnStart.innerHTML = `<i class="ph ph-spinner animate-spin"></i> PROCESANDO...`;
    
    log(`Iniciando análisis semántico de ${finalUrls.length} páginas.`, "process");

    // Bucle en Lotes (Batching)
    const BATCH_SIZE = 2; // Seguro para API gratuita
    
    for (let i = 0; i < finalUrls.length; i += BATCH_SIZE) {
        const batch = finalUrls.slice(i, i + BATCH_SIZE);
        log(`Procesando lote ${Math.floor(i/BATCH_SIZE)+1} de ${Math.ceil(finalUrls.length/BATCH_SIZE)}...`, "info");
        
        await Promise.all(batch.map(processSingleUrl));
        
        // Pausa de seguridad para evitar Rate Limit
        await new Promise(r => setTimeout(r, 1000)); 

        if (state.vectors.length > 0) calculateMetrics();
    }

    UI.btnStart.disabled = false;
    UI.btnStart.innerText = "AUDITORÍA COMPLETADA";
    UI.btnStart.className = "w-full py-4 bg-gray-800 text-white font-bold rounded transition flex items-center justify-center gap-2 text-sm";
    log("Proceso finalizado. Gráfico actualizado.", "success");
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
        } else {
            log(`Error en ${url}: ${data.error}`, "warn");
        }
    } catch (e) {
        log(`Fallo de red analizando ${url}`, "error");
    }
}

// ==========================================
// 3. VISUALIZACIÓN & LÓGICA MATEMÁTICA
// ==========================================

function addRowToTable(item) {
    const row = document.createElement('div');
    row.id = `row-${state.vectors.length-1}`;
    row.className = "flex items-center border-b border-gray-800 py-3 px-6 hover:bg-white/5 transition";
    row.innerHTML = `
        <div class="w-1/2 truncate pr-4 text-gray-300 font-mono text-xs" title="${item.url}">
            ${item.url.replace(/^https?:\/\//,'')}
        </div>
        <div class="w-1/4">
            <span class="bg-gray-800 text-gray-400 px-2 py-1 rounded text-[10px] uppercase font-bold tracking-wider">
                ${item.topic}
            </span>
        </div>
        <div class="w-1/4 text-right font-mono text-xs sim-score text-gray-500">
            <span class="animate-pulse">Calculando...</span>
        </div>
    `;
    UI.table.appendChild(row);
    // Auto-scroll tabla
    UI.table.scrollTop = UI.table.scrollHeight;
}

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

    // 3. Actualizar Tabla
    updateTableScores();

    // 4. Métricas Finales
    const passed = state.vectors.filter(v => v.sim > 0.7).length;
    const siteRatio = (passed / state.vectors.length) * 100;
    
    // Focus (Top 25%)
    const sorted = [...state.vectors].sort((a,b) => b.sim - a.sim);
    const topN = Math.max(1, Math.ceil(state.vectors.length * 0.25));
    const focusAvg = sorted.slice(0, topN).reduce((acc, c) => acc + c.sim, 0) / topN;

    document.getElementById('metric-ratio').innerText = siteRatio.toFixed(0) + "%";
    document.getElementById('metric-focus').innerText = (focusAvg * 100).toFixed(0) + "%";
    
    updateChart(state.vectors);
}

function updateTableScores() {
    state.vectors.forEach((v, idx) => {
        const row = document.getElementById(`row-${idx}`);
        if(row) {
            const scoreDiv = row.querySelector('.sim-score');
            const score = (v.sim * 100).toFixed(1);
            
            let colorClass = v.sim >= 0.7 ? 'text-green-400' : 'text-red-400';
            
            scoreDiv.innerHTML = `<span class="${colorClass} font-bold">${score}%</span>`;
        }
    });
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

// Chart.js
let chartInstance = null;
function updateChart(data) {
    const ctx = document.getElementById('topicalGraph');
    if(!ctx) return;
    
    const points = data.map(d => ({
        x: d.sim,
        y: Math.random() * 0.6 + 0.2 // Random Y para dispersión estética
    }));

    if (chartInstance) {
        chartInstance.data.datasets[0].data = points;
        chartInstance.update();
    } else {
        chartInstance = new Chart(ctx, {
            type: 'scatter',
            data: {
                datasets: [{
                    label: 'URL Context',
                    data: points,
                    backgroundColor: ctx => (ctx.raw?.x >= 0.7 ? '#4ade80' : '#f87171'),
                    pointRadius: 6,
                    pointHoverRadius: 10
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