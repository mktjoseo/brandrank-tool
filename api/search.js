const fetch = require('node-fetch');
const cheerio = require('cheerio');

export default async function handler(req, res) {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') { res.status(200).end(); return; }

    const { domain } = req.query;
    if (!domain) return res.status(400).json({ error: 'Falta el dominio' });

    // Normalizamos el dominio (quitamos https://, www., etc para la búsqueda)
    const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
    const baseUrl = `https://${cleanDomain}`;

    try {
        let urls = [];
        let source = '';

        // --- PLAN A: BUSCAR SITEMAPS COMUNES ---
        // Lista de lugares donde suelen esconderse los mapas
        const sitemapVariations = [
            '/sitemap.xml',
            '/wp-sitemap.xml', // WordPress moderno
            '/sitemap_index.xml', // Yoast SEO / RankMath
            '/sitemap/sitemap.xml' // Shopify a veces
        ];

        console.log(`[SEARCH] Buscando sitemaps en ${cleanDomain}...`);

        for (const path of sitemapVariations) {
            try {
                const target = `${baseUrl}${path}`;
                const resp = await fetch(target, { timeout: 5000 }); // 5s timeout para no bloquear
                
                if (resp.ok && resp.headers.get('content-type')?.includes('xml')) {
                    const xml = await resp.text();
                    const $ = cheerio.load(xml, { xmlMode: true });
                    
                    // Extraer URLs (loc)
                    $('loc').each((i, el) => {
                        const link = $(el).text().trim();
                        // Filtros básicos: solo http/s y evitamos imágenes o pdfs en el listado principal
                        if (link.startsWith('http') && !link.match(/\.(jpg|png|pdf|xml|css|js)$/i)) {
                            urls.push(link);
                        }
                    });

                    if (urls.length > 0) {
                        source = `Sitemap (${path})`;
                        console.log(`[SEARCH] ¡Sitemap encontrado! ${urls.length} URLs en ${path}`);
                        break; // ¡Ya tenemos URLs! Dejamos de buscar
                    }
                }
            } catch (e) {
                // Si falla uno, probamos el siguiente silenciosamente
            }
        }

        // Limpieza de duplicados y recorte (máximo 100 para no explotar la API después)
        urls = [...new Set(urls)].slice(0, 100);

        // --- PLAN B: SI NO HAY SITEMAP, USAMOS SERPER (Google Search) ---
        if (urls.length === 0) {
            console.log("[SEARCH] No hay sitemap. Activando Plan B (Serper)...");
            const apiKey = process.env.SERPER_API_KEY;
            
            if (apiKey) {
                const serperRes = await fetch('https://google.serper.dev/search', {
                    method: 'POST',
                    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ q: `site:${cleanDomain}`, num: 20 }) // Pedimos 20
                });
                
                if (serperRes.ok) {
                    const data = await serperRes.json();
                    if (data.organic) {
                        urls = data.organic.map(item => item.link);
                        source = 'Google Search (Serper)';
                    }
                }
            }
        }

        return res.status(200).json({ 
            success: true, 
            source: source || 'Ninguno',
            count: urls.length,
            urls: urls 
        });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}