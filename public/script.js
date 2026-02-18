// ==========================================
// CONFIGURACIÓN GLOBAL
// ==========================================
const CONFIG = {
    BATCH_SIZE: 3,       // Analizamos 3 URLs simultáneamente (para no saturar)
    SIMILARITY_THRESHOLD: 0.7, // Umbral para considerar una URL "relevante" (Site Ratio)
    FOCUS_PERCENTILE: 0.25     // Top 25% para calcular el Focus Ratio
};

// ==========================================
// ESTADO DE LA APLICACIÓN
// ==========================================
let state = {
    domain: '',
    urls: [],            // Lista total de URLs descubiertas
    processedCount: 0,   // Cuántas llevamos analizadas
    vectors: [],         // Aquí guardamos la data de la IA (topic, vector, sim)
    centroid: null,      // El "centro de gravedad" del sitio
    isAnalyzing: false
};

// Referencias al DOM (Elementos de la pantalla)
const UI = {
    input: document.getElementById('domain-input'),
    btnStart: document.getElementById('start-btn'),
    console: document.getElementById('console-output'),
    tableBody: document.getElementById('results-table-body'),
    terminalBody: document.getElementById('terminal-body'),
    metrics: {
        focus: document.getElementById('metric-focus'),
        ratio: document.getElementById('metric-ratio')
    }
};

// ==========================================
// SISTEMA DE LOGS (Consola estilo Hacker)
// ==========================================
function log(message, type = 'info') {
    if (!UI.console) return;
    
    const line = document.createElement('div');
    const time = new Date().toLocaleTimeString('es-ES', { hour12: false });
    
    // Colores según el tipo de mensaje
    let colorClass = 'text-green-400';
    let icon = '➜';
    
    if (type === 'error') { colorClass = 'text-red-500'; icon = '✖'; }
    if (type === 'warn')  { colorClass = 'text-yellow-400'; icon = '⚠'; }
    if (type === 'process') { colorClass = 'text-blue-400'; icon = '⚙'; }
    if (type === 'success') { colorClass = 'text-neon-pink font-bold'; icon = '★'; }

    line.className = "mb-1 font-mono text-sm";
    line.innerHTML = `
        <span class="opacity-40 select-none mr-2">[${time}]</span>
        <span class="${colorClass}">${icon} ${message}</span>
    `;
    
    UI.console.appendChild(line);
    
    // Auto-scroll hacia abajo
    if (UI.terminalBody) {
        UI.terminalBody.scrollTop = UI.terminalBody.scrollHeight;
    }
}

// ==========================================
// LÓGICA PRINCIPAL (El Cerebro)
// ==========================================

async function startAnalysis() {
    // 1. Limpieza y Preparación
    const domainInput = UI.input.value.trim().replace(/https?:\/\//, '').replace(/\/$/, '');
    
    if (!domainInput) {
        log("Por favor, escribe un dominio válido.", "error");
        return;
    }

    // Reset de variables
    state.domain = domainInput;
    state.urls = [];
    state.vectors = [];
    state.processedCount = 0;
    state.centroid = null;
    UI.tableBody.innerHTML = ''; // Limpiar tabla
    updateChart([]); // Limpiar gráfico
    
    log(`Iniciando auditoría para: ${state.domain}`, "success");
    UI.btnStart.disabled = true;
    UI.btnStart.innerText = "Auditando...";

    try {
        // 2. Fase de Descubrimiento (Search)
        log("Buscando URLs indexadas en Google...", "process");
        const searchRes = await fetch(`/api/search?domain=${state.domain}`);
        
        if (!searchRes.ok) throw new Error("Fallo al buscar URLs");
        
        const urlsFound = await searchRes.json();
        
        if (!urlsFound || urlsFound.length === 0) {
            throw new Error("No se encontraron URLs para este dominio.");
        }

        state.urls = urlsFound;
        log(`Encontradas ${state.urls.length} URLs. Iniciando análisis profundo...`, "info");

        // 3. Fase de Análisis (Batch Processing)
        await processUrlsInBatches(state.urls);

        // 4. Finalización
        log("Auditoría completada exitosamente.", "success");
        calculateFinalMetrics();

    } catch (error) {
        log(error.message, "error");
    } finally {
        UI.btnStart.disabled = false;
        UI.btnStart.innerText = "AUDITAR DOMINIO";
    }
}

// --- Procesador por Lotes (Optimización de Velocidad) ---
async function processUrlsInBatches(urls) {
    // Recorremos las URLs en grupos de 3 (BATCH_SIZE)
    for (let i = 0; i < urls.length; i += CONFIG.BATCH_SIZE) {
        const batch = urls.slice(i, i + CONFIG.BATCH_SIZE);
        const batchNumber = Math.floor(i / CONFIG.BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(urls.length / CONFIG.BATCH_SIZE);

        log(`Procesando bloque ${batchNumber}/${totalBatches} (${batch.length} URLs)...`, "process");

        // Lanzamos las peticiones en paralelo y esperamos a que todas terminen
        await Promise.all(batch.map(url => analyzeSingleUrl(url)));

        // Actualizamos cálculos intermedios
        if (state.vectors.length > 0) {
            calculateCentroid();
            updateSimilitudes();
            renderTable();
            updateChart(state.vectors);
        }

        // Pequeña pausa para respirar (1 segundo)
        await new Promise(r => setTimeout(r, 1000));
    }
}

// --- Análisis Individual de una URL ---
async function analyzeSingleUrl(url) {
    try {
        const response = await fetch('/api/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });

        const json = await response.json();

        if (json.success && json.data) {
            // Guardamos el resultado en el estado
            state.vectors.push({
                url: json.data.url,
                topic: json.data.topic || "Desconocido",
                vector: json.data.vector,
                sim: 0 // Se calculará después contra el centroide
            });
            log(`Analizado: ${cleanUrl(url)}`, "info");
        } else {
            log(`Fallo en ${cleanUrl(url)}: ${json.error || 'Error desconocido'}`, "warn");
        }
    } catch (error) {
        log(`Error de red en ${cleanUrl(url)}`, "error");
    }
}

// ==========================================
// MATEMÁTICAS VECTORIALES
// ==========================================

// 1. Calcular el Centroide (Promedio de todos los vectores)
function calculateCentroid() {
    if (state.vectors.length === 0) return;

    const dim = state.vectors[0].vector.length;
    let sumVector = new Array(dim).fill(0);

    // Sumar todos los vectores
    state.vectors.forEach(item => {
        for (let i = 0; i < dim; i++) {
            sumVector[i] += item.vector[i];
        }
    });

    // Dividir por el número de vectores para sacar el promedio
    state.centroid = sumVector.map(val => val / state.vectors.length);
}

// 2. Calcular Similitud Coseno
function cosineSimilarity(vecA, vecB) {
    if (!vecA || !vecB) return 0;
    
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// 3. Actualizar similitudes de todas las páginas contra el nuevo centroide
function updateSimilitudes() {
    if (!state.centroid) return;

    state.vectors.forEach(item => {
        item.sim = cosineSimilarity(item.vector, state.centroid);
    });

    // Ordenamos de mayor a menor similitud
    state.vectors.sort((a, b) => b.sim - a.sim);
}

// 4. Calcular Métricas Finales (Focus & Ratio)
function calculateFinalMetrics() {
    if (state.vectors.length === 0) return;

    // --- SITE RATIO (% de URLs con sim > 0.7) ---
    const passing = state.vectors.filter(v => v.sim >= CONFIG.SIMILARITY_THRESHOLD).length;
    const siteRatio = (passing / state.vectors.length) * 100;

    // --- FOCUS RATIO (Promedio del Top 25%) ---
    const topCount = Math.max(1, Math.ceil(state.vectors.length * CONFIG.FOCUS_PERCENTILE));
    const topVectors = state.vectors.slice(0, topCount);
    const focusSum = topVectors.reduce((acc, curr) => acc + curr.sim, 0);
    const focusRatio = (focusSum / topCount) * 100;

    // Actualizar UI con animación
    animateValue("metric-ratio", 0, siteRatio, 1500, true);
    animateValue("metric-focus", 0, focusRatio, 1500, false); // El focus suele ser 0-1, lo multipliqué x100
}

// ==========================================
// INTERFAZ DE USUARIO (Render)
// ==========================================

function renderTable() {
    if (!UI.tableBody) return;
    UI.tableBody.innerHTML = '';

    state.vectors.forEach(item => {
        const row = document.createElement('tr');
        const score = (item.sim * 100).toFixed(1);
        const isPass = item.sim >= CONFIG.SIMILARITY_THRESHOLD;
        
        row.className = "border-b border-gray-800 hover:bg-white/5 transition";
        row.innerHTML = `
            <td class="p-3 truncate max-w-[200px]" title="${item.url}">${cleanUrl(item.url)}</td>
            <td class="p-3 text-gray-400">${item.topic}</td>
            <td class="p-3 font-mono ${isPass ? 'text-green-400' : 'text-red-400'}">${score}%</td>
            <td class="p-3 text-center">
                <span class="px-2 py-1 rounded text-xs ${isPass ? 'bg-green-900/30 text-green-300' : 'bg-red-900/30 text-red-300'}">
                    ${isPass ? 'PASS' : 'FAIL'}
                </span>
            </td>
        `;
        UI.tableBody.appendChild(row);
    });
}

// Helper para limpiar URL visualmente
function cleanUrl(url) {
    return url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
}

// Animación de números
function animateValue(id, start, end, duration, isPercent) {
    const obj = document.getElementById(id);
    if (!obj) return;
    let startTimestamp = null;
    const step = (timestamp) => {
        if (!startTimestamp) startTimestamp = timestamp;
        const progress = Math.min((timestamp - startTimestamp) / duration, 1);
        const value = Math.floor(progress * (end - start) + start);
        obj.innerHTML = value + (isPercent ? "%" : "");
        if (progress < 1) window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
}

// ==========================================
// GRÁFICO (Chart.js)
// ==========================================
let scatterChart = null;

function updateChart(data) {
    const ctx = document.getElementById('topicalGraph');
    if (!ctx) return;

    // Mapeamos los datos para el gráfico de dispersión
    // X = Similitud, Y = Aleatorio (para dispersar visualmente)
    const chartData = data.map(v => ({
        x: v.sim, 
        y: Math.random() * 0.5 + 0.25, // Mantiene los puntos centrados verticalmente
        url: cleanUrl(v.url),
        topic: v.topic
    }));

    if (scatterChart) {
        scatterChart.data.datasets[0].data = chartData;
        scatterChart.update();
    } else {
        scatterChart = new Chart(ctx, {
            type: 'scatter',
            data: {
                datasets: [{
                    label: 'Páginas Analizadas',
                    data: chartData,
                    backgroundColor: (ctx) => {
                        const val = ctx.raw?.x || 0;
                        return val >= CONFIG.SIMILARITY_THRESHOLD ? '#4ade80' : '#f87171';
                    },
                    pointRadius: 6,
                    pointHoverRadius: 8
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { 
                        min: 0, 
                        max: 1, 
                        grid: { color: '#333' },
                        title: { display: true, text: 'Coherencia Semántica (Similitud)', color: '#666' }
                    },
                    y: { 
                        display: false, // Ocultamos el eje Y porque es aleatorio
                        min: 0, 
                        max: 1 
                    }
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: (ctx) => `${ctx.raw.url} (${(ctx.raw.x * 100).toFixed(1)}%)`
                        }
                    },
                    legend: { display: false }
                }
            }
        });
    }
}

// Listener del botón
if (UI.btnStart) {
    UI.btnStart.addEventListener('click', startAnalysis);
}