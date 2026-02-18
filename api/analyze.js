const cheerio = require('cheerio');

// CONFIGURACIÓN DE MODELOS
// Usamos v1beta para tener acceso a los últimos modelos.
const API_VERSION = "v1beta";
const EMBEDDING_MODEL = "text-embedding-004"; // Obligatorio para vectores
const GENERATIVE_MODEL = "gemini-1.5-flash";   // Modelo rápido para texto

export default async function handler(req, res) {
    // 1. CORS
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
        const scraperUrl = `http://api.scraperapi.com?api_key=${scraperKey}&url=${encodeURIComponent(url)}&render=false`;
        const scrapeRes = await fetch(scraperUrl);
        
        if (!scrapeRes.ok) throw new Error(`Error ScraperAPI: ${scrapeRes.status}`);
        
        const html = await scrapeRes.text();

        // --- PASO 2: LIMPIEZA HTML ---
        const $ = cheerio.load(html);
        $('script, style, nav, footer, iframe, svg, noscript, header, aside').remove();
        let text = $('body').text().replace(/\s+/g, ' ').trim();
        text = text.substring(0, 8000); // Límite de caracteres

        if (text.length < 50) return res.status(200).json({ success: false, error: "Contenido vacío" });

        // --- PASO 3: IA (REST API DIRECTA - SIN SDK) ---

        // A) VECTORES (Embedding)
        let vector = [];
        try {
            // URL directa a la API de Google v1beta
            const embedUrl = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${EMBEDDING_MODEL}:embedContent?key=${geminiKey}`;
            
            const embedResponse = await fetch(embedUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: `models/${EMBEDDING_MODEL}`,
                    content: { parts: [{ text: text }] }
                })
            });

            if (!embedResponse.ok) {
                // Fallback automático al modelo viejo si el nuevo falla
                console.warn("Fallo embedding 004, intentando 001...");
                const fallbackUrl = `https://generativelanguage.googleapis.com/v1/models/embedding-001:embedContent?key=${geminiKey}`;
                const fallbackRes = await fetch(fallbackUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: "models/embedding-001",
                        content: { parts: [{ text: text }] }
                    })
                });
                const fallbackData = await fallbackRes.json();
                if(fallbackData.embedding) vector = fallbackData.embedding.values;
                else throw new Error("Fallo total de embedding");
            } else {
                const embedData = await embedResponse.json();
                vector = embedData.embedding.values;
            }
        } catch (e) {
            console.error("Error Embedding:", e);
            throw new Error("No se pudo vectorizar el contenido.");
        }

        // B) TEXTO (Resumen JSON)
        let aiData = { topic: "General", summary: "No disponible" };
        try {
            const genUrl = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${GENERATIVE_MODEL}:generateContent?key=${geminiKey}`;
            
            const prompt = `Analiza este texto web.
            Responde SOLO un JSON válido: {"topic": "Tema Principal (1-3 palabras)", "summary": "Resumen de 1 frase"}.
            Texto: ${text.substring(0, 2500)}`;

            const genResponse = await fetch(genUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: { responseMimeType: "application/json" }
                })
            });

            if (genResponse.ok) {
                const genData = await genResponse.json();
                const rawText = genData.candidates?.[0]?.content?.parts?.[0]?.text;
                if (rawText) aiData = JSON.parse(rawText);
            }
        } catch (e) {
            console.error("Error Generativo:", e);
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
        console.error("CRITICAL BACKEND ERROR:", error);
        return res.status(500).json({ success: false, error: error.message });
    }
}