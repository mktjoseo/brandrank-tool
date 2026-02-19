const cheerio = require('cheerio');
const fetch = require('node-fetch');

const API_VERSION = "v1beta";
// CLAVE 1: Modelo idéntico al que funcionó en Colab
const EMBEDDING_MODEL = "gemini-embedding-001"; 
const GENERATIVE_MODEL = "gemini-1.5-flash";   

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.status(200).end(); return; }

    const { url } = req.body;
    const scraperKey = process.env.SCRAPERAPI_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;

    if (!scraperKey || !geminiKey) return res.status(500).json({ error: 'Faltan API Keys' });

    try {
        // --- 1. SCRAPING (Clon de Python: descargar_y_parsear) ---
        const scraperUrl = `http://api.scraperapi.com?api_key=${scraperKey}&url=${encodeURIComponent(url)}&render=false`;
        const scrapeRes = await fetch(scraperUrl);
        if (!scrapeRes.ok) throw new Error(`Scraper status: ${scrapeRes.status}`);
        
        const html = await scrapeRes.text();
        const $ = cheerio.load(html);

        // Extracción idéntica al Colab
        const title = $('title').text().trim() || 'Sin título';
        const h1 = $('h1').first().text().trim() || '';
        
        let snippet = '';
        $('p').each((i, el) => {
            // Limpiamos los espacios múltiples
            const texto = $(el).text().replace(/\s+/g, ' ').trim();
            // Lógica: Si el párrafo tiene más de 80 chars, lo guardamos y rompemos el bucle
            if (texto.length > 80 && !snippet) {
                snippet = texto;
            }
        });

        // Combinamos la info para la IA (Title > H1 > Snippet)
        const textToAnalyze = `Title: ${title}\nH1: ${h1}\nSnippet: ${snippet}`.trim();

        if (textToAnalyze.length < 20) throw new Error("Contenido vacío (Web bloqueada o puro JS)");

        // --- 2. IA (Google AI Studio) ---
        const callGoogle = async (endpoint, body) => {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error?.message || response.statusText);
            return data;
        };

        // A) VECTORES (Usando el modelo 001 del Colab)
        const embedUrl = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${EMBEDDING_MODEL}:embedContent?key=${geminiKey}`;
        const embedData = await callGoogle(embedUrl, {
            // Importante: El modelo 001 requiere que especifiquemos el modelo dentro del body también
            model: `models/${EMBEDDING_MODEL}`,
            content: { parts: [{ text: textToAnalyze }] },
            taskType: "SEMANTIC_SIMILARITY" 
        });

        if (!embedData.embedding || !embedData.embedding.values) {
            throw new Error("Google devolvió un objeto sin valores de vector.");
        }

        // B) CLASIFICACIÓN (Resumen corto)
        let aiData = { topic: "General", summary: title };
        try {
            const genUrl = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${GENERATIVE_MODEL}:generateContent?key=${geminiKey}`;
            const prompt = `Analiza este extracto web: ${textToAnalyze}. Responde SOLO un JSON válido: {"topic": "Tema Principal (1-2 palabras)", "summary": "Resumen muy breve (1 linea)"}`;
            const genData = await callGoogle(genUrl, { contents: [{ parts: [{ text: prompt }] }] });
            let raw = genData.candidates?.[0]?.content?.parts?.[0]?.text;
            if (raw) aiData = JSON.parse(raw.replace(/```json|```/g, '').trim());
        } catch(e) { console.warn("Fallo resumen:", e.message); }

        return res.status(200).json({
            success: true,
            data: {
                url,
                vector: embedData.embedding.values,
                topic: aiData.topic,
                summary: aiData.summary,
                debug_text: textToAnalyze // Lo pasamos al frontend para el log
            }
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}