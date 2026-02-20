let state = {
    domain: 'Manual Input',
    urls: [],
    vectors: [],
    metrics: { focus: 0, radius: 0, ratio: 0 }
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

async function analyzeManualUrls() {
    const text = document.getElementById('urlInput').value;
    const urls = text.split('\n').map(u => u.trim()).filter(u => u.startsWith('http'));
    
    if (urls.length === 0) return alert("Pega al menos una URL válida.");
    
    state.urls = urls;
    state.domain = new URL(urls[0]).hostname; 
    
    document.getElementById('step-results').classList.add('hidden');
    log(`🚀 Iniciando análisis vectorial de ${urls.length} URLs...`, 'process');
    
    await processUrlBatch(urls);
}

async function startDiscovery() {
    const domain = document.getElementById('domainSearchInput').value.trim();
    if (!domain) return;
    
    log(`🔎 Buscando URLs en ${domain}...`, 'process');
    try {
        const res = await fetch(`/api/search?domain=${domain}`);
        const data = await res.json();
        if (data.debugLogs) data.debugLogs.forEach(l => log(`SERVER: ${l}`, 'data'));
        if (!data.success) throw new Error(data.error);
        
        document.getElementById('urlInput').value = data.urls.join('\n');
        log(`✅ Encontradas ${data.urls.length} URLs. Dale a 'CALCULAR'.`, 'process');
    } catch (e) { log(`❌ Error: ${e.message}`, 'error'); }
}

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
                log(`📄 Vectorizado: ${new URL(data.data.url).pathname}`, 'data');
            } else {
                log(`⚠️ Fallo: ${data.error}`, 'error');
            }
        });
    }

    if (results.length > 0) {
        processMetrics(results);
        renderDashboard();
        generateEntityProfile(results); 
    } else {
        log("❌ Ninguna URL pudo ser analizada.", 'error');
    }
}

// --- SÚPER RESUMEN IA ---
async function generateEntityProfile(results) {
    document.getElementById('ai-summary').innerHTML = '<span class="animate-pulse text-neon-pink">Generando Perfil de Entidad con IA...</span>';
    
    const contents = results.map(r => `- ${r.extracted.title} (H1: ${r.extracted.h1})`);
    
    try {
        const res = await fetch('/api/summary', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ domain: state.domain, contents })
        });
        const data = await res.json();
        if(data.success) {
            document.getElementById('ai-summary').innerText = data.summary;
        } else {
            document.getElementById('ai-summary').innerText = "No se pudo generar el resumen.";
        }
    } catch(e) {
        document.getElementById('ai-summary').innerText = "Error conectando con la IA.";
    }
}

function processMetrics(data) {
    const dim = data[0].vector.length;
    const centroid = new Array(dim).fill(0);
    data.forEach(d => d.vector.forEach((v, i) => centroid[i] += v));
    centroid.forEach((v, i) => centroid[i] /= data.length);

    state.vectors = data.map(d => {
        let dot = 0, mA = 0, mB = 0;
        for (let i = 0; i < dim; i++) {
            dot += d.vector[i] * centroid[i];
            mA += d.vector[i] ** 2; mB += centroid[i] ** 2;
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
}

function renderDashboard() {
    document.getElementById('step-results').classList.remove('hidden');
    document.getElementById('download-btn').classList.remove('hidden');

    document.getElementById('val-focus').innerText = state.metrics.focus;
    document.getElementById('val-ratio').innerText = state.metrics.ratio + '%';
    document.getElementById('val-radius').innerText = state.metrics.radius;

    const vCard = document.getElementById('final-verdict');
    if(state.metrics.ratio >= 80) {
        vCard.innerText = "AUTORIDAD"; vCard.className = "text-2xl font-black text-neon-green drop-shadow-[0_0_8px_rgba(0,255,157,0.8)]";
    } else if(state.metrics.ratio >= 50) {
        vCard.innerText = "ESTABLE"; vCard.className = "text-2xl font-black text-yellow-400 drop-shadow-[0_0_8px_rgba(253,224,71,0.8)]";
    } else {
        vCard.innerText = "DILUIDO"; vCard.className = "text-2xl font-black text-red-500 drop-shadow-[0_0_8px_rgba(239,68,68,0.8)]";
    }

    const tbody = document.getElementById('results-table-body');
    tbody.innerHTML = '';
    
    state.vectors.sort((a,b) => b.sim - a.sim).forEach(v => {
        const color = v.sim > 0.7 ? 'text-neon-green' : (v.sim > 0.5 ? 'text-yellow-400' : 'text-red-500');
        const status = v.sim > 0.7 ? 'PASS' : 'WARN';
        
        let cleanPath = new URL(v.url).pathname;
        if(cleanPath === '/') cleanPath = 'Home (/)';
        
        // Tabla limpia sin la columna Topic
        tbody.innerHTML += `
        <tr class="border-b border-gray-800 hover:bg-white/5 align-top">
            <td class="p-4 pl-2">
                <a href="${v.url}" target="_blank" class="text-neon-pink hover:text-white text-xs font-mono break-all inline-block mb-2">${cleanPath}</a>
                <div class="text-sm text-white font-bold mb-1">${v.extracted?.title}</div>
                <div class="text-xs text-gray-500 font-mono">H1: ${v.extracted?.h1}</div>
                <div class="text-xs text-gray-600 font-mono mt-1">H2: ${v.extracted?.h2}</div>
            </td>
            <td class="p-4 text-xs text-gray-400 leading-relaxed font-sans">
                <div class="line-clamp-4" title="${v.extracted?.snippet}">${v.extracted?.snippet}</div>
            </td>
            <td class="p-4 text-right font-mono text-white text-base">${v.sim.toFixed(3)}</td>
            <td class="p-4 text-right pr-2 font-bold text-xs ${color}">${status}</td>
        </tr>`;
    });

    renderChart();
    document.getElementById('step-results').scrollIntoView({behavior:'smooth'});
}

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
            plugins: { 
                legend: {display:false}, 
                tooltip: { 
                    callbacks: { 
                        // AQUÍ ESTÁ EL ARREGLO DEL TOOLTIP PARA MOSTRAR LA RUTA DE LA URL
                        label: (ctx) => {
                            if (ctx.raw.x === 0) return 'Centro Ideal';
                            let path = new URL(ctx.raw.url).pathname;
                            if (path === '/') path = 'Home (/)';
                            return `${path} | Similitud: ${(ctx.raw.sim*100).toFixed(1)}%`;
                        } 
                    } 
                } 
            }
        }
    });
}

function downloadExcelReport() {
    if (!window.XLSX) return;
    const ws1 = XLSX.utils.aoa_to_sheet([["BrandRank Report"], ["Focus", state.metrics.focus], ["Ratio", state.metrics.ratio+"%"]]);
    const ws2 = XLSX.utils.aoa_to_sheet([
        ["URL", "Título", "H1", "H2 (Muestra)", "Fragmento Extraído", "Similitud", "Estado"], 
        ...state.vectors.map(v => [v.url, v.extracted?.title, v.extracted?.h1, v.extracted?.h2, v.extracted?.snippet, v.sim, v.sim>0.7?"PASS":"FAIL"])
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws1, "Resumen");
    XLSX.utils.book_append_sheet(wb, ws2, "Detalle");
    XLSX.writeFile(wb, `brandrank_audit.xlsx`);
}

const handle = document.getElementById('drag-handle');
const footer = document.getElementById('console-footer');
if(handle && footer) {
    let isDragging = false, startY, startHeight;
    handle.addEventListener('mousedown', (e) => { isDragging = true; startY = e.clientY; startHeight = footer.offsetHeight; document.body.style.cursor = 'row-resize'; });
    document.addEventListener('mousemove', (e) => { if(!isDragging) return; footer.style.height = `${Math.min(Math.max(startHeight + (startY - e.clientY), 35), window.innerHeight * 0.8)}px`; });
    document.addEventListener('mouseup', () => { isDragging = false; document.body.style.cursor = 'default'; });
}