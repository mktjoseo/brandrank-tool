const cheerio = require('cheerio');
const fetch = require('node-fetch');

const API_VERSION = "v1beta";
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
        // --- 1. SCRAPING (Extracción Transparente) ---
        const scraperUrl = `http://api.scraperapi.com?api_key=${scraperKey}&url=${encodeURIComponent(url)}&render=false`;
        const scrapeRes = await fetch(scraperUrl);
        if (!scrapeRes.ok) throw new Error(`Scraper status: ${scrapeRes.status}`);
        
        const html = await scrapeRes.text();
        const $ = cheerio.load(html);

        const title = $('title').text().trim() || 'Sin título';
        const h1 = $('h1').first().text().trim() || 'Sin H1';
        
        let snippet = '';
        $('p').each((i, el) => {
            const texto = $(el).text().replace(/\s+/g, ' ').trim();
            if (texto.length > 80 && !snippet) {
                snippet = texto;
            }
        });
        if (!snippet) snippet = "No se encontró texto descriptivo largo.";

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

        // A) VECTORES (Embedding 001)
        const embedUrl = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${EMBEDDING_MODEL}:embedContent?key=${geminiKey}`;
        const embedData = await callGoogle(embedUrl, {
            model: `models/${EMBEDDING_MODEL}`,
            content: { parts: [{ text: textToAnalyze }] },
            taskType: "SEMANTIC_SIMILARITY" 
        });

        // B) CLASIFICACIÓN (Mejorado con JSON Forzado)
        let aiData = { topic: "General", summary: title };
        try {
            const genUrl = `https://generativelanguage.googleapis.com/${API_VERSION}/models/${GENERATIVE_MODEL}:generateContent?key=${geminiKey}`;
            
            // Prompt mejorado para forzar categorías reales
            const prompt = `Eres un experto SEO. Analiza este contenido web y categorízalo de forma muy específica (ej: "Música", "Cursos Online", "E-commerce", "Blog Tecnología"). 
            Contenido: ${textToAnalyze}
            
            Responde ÚNICAMENTE usando este esquema JSON exacto:
            {"topic": "Categoría exacta (1 o 2 palabras máximo)", "summary": "De qué trata la página en 10 palabras"}`;

            const genData = await callGoogle(genUrl, { 
                contents: [{ parts: [{ text: prompt }] }],
                // ESTO ES CLAVE: Obligamos a Gemini a devolver JSON nativo sin formato Markdown
                generationConfig: { responseMimeType: "application/json" }
            });
            
            let raw = genData.candidates?.[0]?.content?.parts?.[0]?.text;
            if (raw) aiData = JSON.parse(raw.trim());
        } catch(e) { 
            console.warn("Fallo resumen:", e.message); 
        }

        return res.status(200).json({
            success: true,
            data: {
                url,
                vector: embedData.embedding.values,
                topic: aiData.topic,
                summary: aiData.summary,
                // Devolvemos la data desglosada para pintarla en la tabla del frontend
                extracted: {
                    title: title,
                    h1: h1,
                    snippet: snippet
                }
            }
        });

    } catch (error) {
        return res.status(500).json({ success: false, error: error.message });
    }
}