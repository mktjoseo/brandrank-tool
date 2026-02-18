const cheerio = require('cheerio');
const fetch = require('node-fetch');

// CONFIGURACIÓN DE MODELOS GOOGLE AI STUDIO
const API_VERSION = "v1beta";
// Modelo matemático obligatorio para Site Focus
const EMBEDDING_MODEL = "text-embedding-004"; 
// Modelo de texto rápido y barato
const GENERATIVE_MODEL = "gemini-1.5-flash";   

export default async function handler(req, res) {
    // 1. CORS Headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { url } = req.body;
    const scraperKey = process.env.SCRAPERAPI_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    if (!scraperKey || !geminiKey) return res.status(500).json({ error: 'Faltan API Keys en Vercel' });

    try {
        // --- PASO 1: SCRAPING ---
        // Usamos render=false para velocidad. Si la web es puro JS y sale vacía, cambiar a true.
        const scraperUrl = `http://api.scraperapi.com?api_key=${scraperKey}&url=${encodeURIComponent(url)}&render=false`;
        const scrapeRes = await fetch(scraperUrl);
        
        if (!scrapeRes.ok) throw new Error(`Error ScraperAPI: ${scrapeRes.status}`);
        
        const html = await scrapeRes.text();

        // --- PASO 2: LIMPIEZA HTML ---
        const $ = cheerio.load(html);
        $('script, style, nav, footer, iframe, svg, noscript, header, aside').remove();
        let text = $('body').text().replace(/\s+/g, ' ').trim();
        // Cortamos a 8000 caracteres para asegurar que cabe en el modelo de embedding
        text = text.substring(0, 8000);

        if (text.length < 50) return res.status(200).json({ success: false, error: "Contenido vacío o bloqueado" });

        // --- PASO 3: IA CON GOOGLE AI STUDIO (REST API) ---

        // Función auxiliar para manejar errores de Google
        const callGoogle = async (endpoint, body) => {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await response.json();
            if (!response.ok) {
                const msg = data.error ? `${data.error.code} - ${data.error.message}` : response.statusText;
                throw new Error(`Google API Error: ${msg}`);
            }
            return data;
        };

        // A) VECTORES (Embedding)
        let vector = [];
        try {
            const embedUrl = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${EMBEDDING_MODEL}:embedContent?key=${geminiKey}`;
            const data = await callGoogle(embedUrl, {
                model: `models/${EMBEDDING_MODEL}`,
                content: { parts: [{ text: text }] }
            });
            
            if (data.embedding && data.embedding.values) {
                vector = data.embedding.values;
            } else {
                throw new Error("Respuesta de embedding vacía");
            }
        } catch (e) {
            console.warn(`Fallo embedding 004 (${e.message}), intentando fallback a 001...`);
            // Fallback al modelo viejo (embedding-001) que es muy robusto
            try {
                const fallbackUrl = `https://generativelanguage.googleapis.com/v1/models/embedding-001:embedContent?key=${geminiKey}`;
                const data = await callGoogle(fallbackUrl, {
                    model: "models/embedding-001",
                    content: { parts: [{ text: text }] }
                });
                vector = data.embedding.values;
            } catch (e2) {
                throw new Error(`No se pudo vectorizar: ${e2.message}`);
            }
        }

        // B) TEXTO (Resumen JSON)
        let aiData = { topic: "General", summary: "Análisis no disponible" };
        try {
            const genUrl = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${GENERATIVE_MODEL}:generateContent?key=${geminiKey}`;
            
            const prompt = `Analiza este texto web.
            Responde SOLO un JSON válido: {"topic": "Tema Principal (1-3 palabras)", "summary": "Resumen de 1 frase"}.
            Texto: ${text.substring(0, 2000)}`;

            const data = await callGoogle(genUrl, {
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { responseMimeType: "application/json" }
            });

            const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
            if (rawText) aiData = JSON.parse(rawText);

        } catch (e) {
            console.error("Error Generativo (No crítico):", e.message);
            // No fallamos la petición entera si solo falla el resumen
        }

        return res.status(200).json({
            success: true,
            data: {
                url,
                vector,
                topic: aiData.topic,
                summary: aiData.summary
            }
        });

    } catch (error) {
        console.error("CRITICAL BACKEND ERROR:", error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
}