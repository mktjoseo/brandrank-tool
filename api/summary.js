const fetch = require('node-fetch');

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.status(200).end(); return; }
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    const { domain, contents } = req.body;
    const geminiKey = process.env.GEMINI_API_KEY;

    if (!geminiKey) return res.status(500).json({ error: 'Falta API Key de Gemini en Vercel' });

    try {
        const genUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
        
        // ---> AQUÍ ES DONDE SE MODIFICA EL PROMPT DE LA IA <---
        const prompt = `Actúa como un analista SEO estricto y directo. He analizado la web '${domain}'. 
        Títulos y H1:
        ${contents.join('\n')}
        
        Escribe un "Perfil de Entidad" ultra conciso. REGLAS ESTRICTAS:
        - Máximo absoluto de 2 párrafos cortos (2 oraciones por párrafo).
        - Párrafo 1: Define de qué trata esta web (su entidad).
        - Párrafo 2: Evalúa la coherencia semántica (¿hay páginas basura o está todo bien focalizado?).
        - Cero introducciones (no digas "Esta web trata de...", ve directo al grano).
        - No uses formato markdown.`;
        // ---> FIN DEL PROMPT <---

        const response = await fetch(genUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        
        const data = await response.json();
        
        if (!response.ok) throw new Error(data.error?.message || 'Error en Gemini API');

        const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || "No se pudo generar el perfil de entidad.";

        return res.status(200).json({ success: true, summary: aiText });

    } catch (error) {
        console.error("Error en summary.js:", error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
}