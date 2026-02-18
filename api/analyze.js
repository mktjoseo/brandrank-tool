const fetch = require('node-fetch');

export default async function handler(req, res) {
    // Headers CORS
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.status(200).end(); return; }

    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) return res.status(500).json({ error: 'Falta GEMINI_API_KEY' });

    try {
        // Consultamos la lista de modelos disponibles para TU cuenta
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error?.message || response.statusText);
        }

        // Filtramos solo los que sirven para "Embeddings" (convertir texto a números)
        const embeddingModels = data.models
            ? data.models.filter(m => m.name.includes('embed') || m.supportedGenerationMethods.includes('embedContent'))
            : [];

        // Devolvemos la lista al frontend para que la veas
        return res.status(200).json({
            success: false, // Ponemos false para que el frontend muestre el error/mensaje
            error: "MODO ESCÁNER EJECUTADO", 
            debugInfo: {
                mensaje: "Copia estos nombres de modelo y pásamelos:",
                modelos_encontrados: embeddingModels.map(m => m.name),
                todos_los_modelos: data.models ? data.models.map(m => m.name) : []
            }
        });

    } catch (error) {
        return res.status(500).json({ error: `Error escaneando: ${error.message}` });
    }
}