const fetch = require('node-fetch');

// LISTA DE CANDIDATOS A PROBAR (Fuerza Bruta)
const CANDIDATE_MODELS = [
    "models/text-embedding-004",
    "text-embedding-004",
    "models/embedding-001",
    "embedding-001"
];

export default async function handler(req, res) {
    // 1. Configuración básica (CORS)
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.status(200).end(); return; }

    const { url } = req.body;
    const scraperKey = process.env.SCRAPERAPI_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    if (!geminiKey) return res.status(500).json({ error: 'Falta GEMINI_API_KEY' });

    try {
        // --- PARTE 1: SCRAPING (Tu versión optimizada de Metadatos) ---
        // (Si esto falla, ponemos datos falsos para probar solo la IA)
        let textToAnalyze = "Test de conexión";
        let title = "Test Mode";
        
        if (scraperKey && url) {
            try {
                const scraperUrl = `http://api.scraperapi.com?api_key=${scraperKey}&url=${encodeURIComponent(url)}&render=false`;
                const sRes = await fetch(scraperUrl);
                if (sRes.ok) {
                    const html = await sRes.text();
                    // Extracción básica sin cheerio para evitar errores si la librería falla
                    const tMatch = html.match(/<title>(.*?)<\/title>/i);
                    title = tMatch ? tMatch[1] : url;
                    textToAnalyze = `URL: ${url} Title: ${title}`;
                }
            } catch (e) {
                console.log("Scraping falló, usando datos dummy para probar IA");
            }
        }

        // --- PARTE 2: FUERZA BRUTA CON GOOGLE ---
        let vector = [];
        let usedModel = "";
        let lastError = "";

        // Probamos los modelos uno por uno
        for (const modelName of CANDIDATE_MODELS) {
            try {
                console.log(`Intentando con modelo: ${modelName}...`);
                const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${modelName}:embedContent?key=${geminiKey}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        content: { parts: [{ text: textToAnalyze }] }
                    })
                });

                const data = await response.json();

                if (response.ok && data.embedding) {
                    vector = data.embedding.values;
                    usedModel = modelName;
                    console.log(`¡ÉXITO! Modelo funcional encontrado: ${modelName}`);
                    break; // ¡Funcionó! Salimos del bucle
                } else {
                    lastError = data.error?.message || response.statusText;
                    console.log(`Fallo con ${modelName}: ${lastError}`);
                }
            } catch (err) {
                console.log(`Error de red con ${modelName}: ${err.message}`);
            }
        }

        if (vector.length === 0) {
            // Si llegamos aquí, NINGUNO funcionó.
            return res.status(200).json({ // Usamos 200 para que el frontend muestre el mensaje
                success: false,
                error: `Fallo total de IA. Último error: ${lastError}. Revisa que la API 'Generative Language API' esté habilitada en Google Cloud.`
            });
        }

        // --- PARTE 3: ÉXITO ---
        return res.status(200).json({
            success: true,
            data: {
                url: url || "test-url",
                vector: vector,
                topic: `Modelo: ${usedModel}`, // Te dirá cuál funcionó
                summary: title
            }
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: `Crash del servidor: ${error.message}` });
    }
}