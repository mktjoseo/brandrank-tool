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
        // SOLUCIÓN: Usamos el modelo 2.5-flash que sí está en tu lista permitida
        const genUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
        
        const prompt = `Actúa como un experto en SEO semántico. He analizado la web '${domain}'. 
        Aquí tienes los Títulos y H1 de sus páginas principales:
        
        ${contents.join('\n')}
        
        Escribe un "Perfil de Entidad" de 2 párrafos. 
        Párrafo 1: Define de qué trata exactamente esta web (su entidad principal).
        Párrafo 2: Evalúa la coherencia semántica de estas URLs. ¿Están alineadas con el tema principal o hay contenido disperso?
        Usa un tono analítico y profesional. No uses Markdown grueso (ni asteriscos ni negritas), solo texto plano estructurado.`;

        const response = await fetch(genUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error?.message || 'Error en Gemini API');
        }

        const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text || "No se pudo generar el texto.";

        return res.status(200).json({ success: true, summary: aiText });

    } catch (error) {
        console.error("Error en summary.js:", error.message);
        return res.status(500).json({ success: false, error: error.message });
    }
}