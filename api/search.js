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

    // Limpieza del dominio
    const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
    const baseUrl = `https://${cleanDomain}`;

    try {
        let urls = [];
        let source = '';

        // --- PLAN A: SITEMAP (Con camuflaje de navegador) ---
        const sitemapVariations = [
            '/sitemap_index.xml',  // <--- El más común en WordPress modernos
            '/sitemap.xml',
            '/wp-sitemap.xml',
            '/sitemap/sitemap.xml'
        ];

        console.log(`[SEARCH] Buscando sitemaps en ${cleanDomain}...`);

        for (const path of sitemapVariations) {
            try {
                const target = `${baseUrl}${path}`;
                // console.log(`[DEBUG] Probando: ${target}`);

                // HACEMOS LA PETICIÓN DISFRAZADOS DE CHROME
                const resp = await fetch(target, { 
                    timeout: 8000,
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
                    }
                });
                
                if (resp.ok) {
                    const xml = await resp.text();
                    
                    // Validación simple: ¿Parece XML?
                    if (xml.trim().startsWith('<?xml') || xml.includes('<urlset') || xml.includes('<sitemapindex')) {
                        const $ = cheerio.load(xml, { xmlMode: true });
                        
                        // Estrategia Doble: Buscar URLs directas (<loc>) 
                        // Nota: Si es un índice de sitemaps, esto agarrará las URLs de los sub-sitemaps. 
                        // Para esta versión simple, está bien, o podemos refinarlo.
                        $('loc').each((i, el) => {
                            const link = $(el).text().trim();
                            // Filtramos basura (imágenes, css, json)
                            if (link.startsWith('http') && !link.match(/\.(jpg|jpeg|png|gif|webp|pdf|xml|css|js|json)$/i)) {
                                urls.push(link);
                            }
                        });

                        if (urls.length > 0) {
                            source = `Sitemap (${path})`;
                            console.log(`[SEARCH] ¡Sitemap capturado! ${urls.length} URLs en ${path}`);
                            break; // ¡Éxito! Salimos del bucle
                        }
                    }
                } else {
                    console.log(`[DEBUG] Falló ${path}: Status ${resp.status}`);
                }
            } catch (e) {
                console.log(`[DEBUG] Error conectando a ${path}: ${e.message}`);
            }
        }

        // --- PLAN B: SERPER (Solo si falló el sitemap) ---
        if (urls.length === 0) {
            console.log("[SEARCH] Sitemaps fallaron. Activando Plan B (Serper)...");
            const apiKey = process.env.SERPER_API_KEY;
            
            if (apiKey) {
                const serperRes = await fetch('https://google.serper.dev/search', {
                    method: 'POST',
                    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ q: `site:${cleanDomain}`, num: 20 })
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

        // Limpieza final: Quitar duplicados y limitar a 100 para no explotar la API de IA
        urls = [...new Set(urls)].slice(0, 100);

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