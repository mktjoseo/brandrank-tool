let model = null;
let urlsDiscovered = [];
let analyzedData = [];

// 1. Inicializar IA del Navegador
async function initIA() {
    log("Cargando cerebro semántico (TensorFlow)...", "process");
    model = await use.load();
    log("IA Lista en el navegador. Proceso local activado.", "success");
}
initIA();

// 2. Buscar URLs
document.getElementById('search-btn').addEventListener('click', async () => {
    const domain = document.getElementById('domain-input').value.trim();
    if (!domain) return;

    log(`Buscando en Serper para: ${domain}...`);
    const res = await fetch(`/api/search?domain=${domain}`);
    urlsDiscovered = await res.json();
    
    renderUrlList();
});

function renderUrlList() {
    const container = document.getElementById('url-list');
    const area = document.getElementById('selection-area');
    container.innerHTML = '';
    
    urlsDiscovered.forEach((url, i) => {
        const div = document.createElement('div');
        div.className = "flex items-center gap-2";
        div.innerHTML = `<input type="checkbox" class="url-cb" value="${url}" ${i<10?'checked':''}> <span class="truncate">${url}</span>`;
        container.appendChild(div);
    });
    area.classList.remove('hidden');
}

// 3. Ejecutar Análisis (Lotes de 10)
document.getElementById('start-btn').addEventListener('click', async () => {
    const selected = Array.from(document.querySelectorAll('.url-cb:checked')).map(cb => cb.value);
    
    if (selected.length > 10) {
        log("Por favor, selecciona máximo 10 URLs para optimizar créditos.", "warn");
        return;
    }

    log(`Iniciando análisis de ${selected.length} páginas...`, "process");
    analyzedData = [];

    for (const url of selected) {
        log(`Extrayendo texto: ${url.split('/').pop() || url}`);
        
        const res = await fetch('/api/analyze', {
            method: 'POST',
            body: JSON.stringify({ url }),
            headers: {'Content-Type': 'application/json'}
        });
        const json = await res.json();

        if (json.success) {
            // Creamos el embedding aquí en el navegador (GRATIS)
            const embeddings = await model.embed([json.data.text]);
            const vector = await embeddings.array();
            
            analyzedData.push({
                url,
                topic: json.data.topic,
                vector: vector[0]
            });
            calculateBrandMetrics();
        }
    }
});

// 4. Matemáticas de Site Focus y Radius
function calculateBrandMetrics() {
    if (analyzedData.length < 2) return;

    // Centroide (Punto medio semántico)
    const dim = analyzedData[0].vector.length;
    let centroid = new Array(dim).fill(0);
    analyzedData.forEach(item => {
        item.vector.forEach((val, i) => centroid[i] += val);
    });
    centroid = centroid.map(v => v / analyzedData.length);

    // Similitud de cada página contra el centroide
    analyzedData.forEach(item => {
        item.sim = cosineSimilarity(item.vector, centroid);
    });

    // Site Focus (Promedio de similitud)
    const focus = analyzedData.reduce((acc, curr) => acc + curr.sim, 0) / analyzedData.length;
    document.getElementById('metric-focus').innerText = (focus * 100).toFixed(1) + "%";
    
    updateTableAndChart();
}

function cosineSimilarity(a, b) {
    let dot = 0, mA = 0, mB = 0;
    for(let i=0; i<a.length; i++) {
        dot += a[i]*b[i]; mA += a[i]*a[i]; mB += b[i]*b[i];
    }
    return dot / (Math.sqrt(mA) * Math.sqrt(mB));
}

function log(m, type) {
    const t = document.getElementById('terminal');
    t.innerHTML += `<div class="mb-1">> ${m}</div>`;
    t.scrollTop = t.scrollHeight;
}