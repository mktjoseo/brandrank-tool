export default async function handler(req, res) {
    // Configuración de permisos (CORS) para que el frontend pueda llamar aquí
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const { domain } = req.query;

    if (!domain) return res.status(400).json({ error: 'Falta el dominio' });

    const apiKey = process.env.SERPER_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Falta API Key de Serper en Vercel' });

    try {
        const response = await fetch('https://google.serper.dev/search', {
            method: 'POST',
            headers: {
                'X-API-KEY': apiKey,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                q: `site:${domain}`,
                num: 20
            })
        });

        if (!response.ok) throw new Error(`Serper error: ${response.status}`);

        const data = await response.json();
        const urls = data.organic ? data.organic.map(item => item.link) : [];
        
        return res.status(200).json({ success: true, urls });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}