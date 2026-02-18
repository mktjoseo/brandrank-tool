import fetch from 'node-fetch';

export default async function handler(req, res) {
    // Headers CORS estándar
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { domain } = req.query;
    const apiKey = process.env.SERPER_API_KEY;

    if (!domain) return res.status(400).json({ error: 'No domain provided' });
    if (!apiKey) return res.status(500).json({ error: 'Missing API Key' });

    try {
        console.log(`Buscando en Serper para: ${domain}`);
        
        const response = await fetch('https://google.serper.dev/search', {
            method: 'POST',
            headers: {
                'X-API-KEY': apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                q: `site:${domain}`,
                num: 20 // Pedimos 20 resultados
            })
        });

        if (!response.ok) {
            throw new Error(`Error Serper API: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        
        // Verificación extra para asegurar que hay datos
        if (!data.organic) {
            console.log("Serper no devolvió organic results:", data);
            return res.status(200).json([]); // Devolvemos array vacío limpio
        }

        const urls = data.organic.map(item => item.link);
        return res.status(200).json(urls);

    } catch (error) {
        console.error("Search Handler Error:", error);
        return res.status(500).json({ error: error.message });
    }
}