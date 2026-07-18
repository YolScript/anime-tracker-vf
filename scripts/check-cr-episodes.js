// Vérifie via l'API interne Crunchyroll (jeton anonyme public) que chaque
// série du catalogue propose encore des épisodes. total=0 saison => lien retiré.
const fs = require("fs");
const { execFile } = require("child_process");
const path = require("path").join(__dirname, "..", "catalog.js");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// Node fetch se fait bloquer (403 Cloudflare) ; curl passe.
function curl(args) {
    return new Promise((resolve) => {
        execFile("curl", ["-s", "-A", UA, ...args], { maxBuffer: 20 * 1024 * 1024 }, (err, stdout) => {
            resolve(err ? null : stdout);
        });
    });
}

async function getAnonToken() {
    const basic = Buffer.from((process.env.CR_CLIENT_ID || "noaihdevm_6iyg0a8l0q") + ":").toString("base64");
    const out = await curl([
        "-X", "POST", "https://www.crunchyroll.com/auth/v1/token",
        "-H", "Authorization: Basic " + basic,
        "-H", "Content-Type: application/x-www-form-urlencoded",
        "-d", "grant_type=client_credentials"
    ]);
    const m = out && out.match(/"access_token":"([^"]+)"/);
    if (!m) throw new Error("token introuvable: " + (out || "").slice(0, 200));
    return m[1];
}

// Résout l'URL (vieux format) vers l'ID de série via la redirection
async function resolveSeriesId(url) {
    const direct = url.match(/\/series\/([A-Z0-9]+)/i);
    if (direct) return { id: direct[1], finalUrl: url };
    const out = await curl(["-o", process.platform === "win32" ? "NUL" : "/dev/null", "-w", "%{http_code} %{url_effective}", "-L", "--max-redirs", "5", "-H", "Accept-Language: fr-FR", url]);
    if (!out) return null;
    const [code, finalUrl] = out.trim().split(" ");
    const m = (finalUrl || "").match(/\/series\/([A-Z0-9]+)/i);
    if (m) return { id: m[1], finalUrl: finalUrl };
    if (code === "404" || code === "410") return { dead: true };
    return null; // indéterminé
}

// Retourne { episodes: bool, vf: bool } ou null si indéterminé
async function checkSeries(token, seriesId) {
    const raw = await curl([
        `https://www.crunchyroll.com/content/v2/cms/series/${seriesId}/seasons?locale=fr-FR`,
        "-H", "Authorization: Bearer " + token
    ]);
    if (!raw) return null;
    try {
        const json = JSON.parse(raw);
        if (json.error || json.code) return null;
        return {
            episodes: (json.total || 0) > 0,
            vf: raw.indexOf('"audio_locale":"fr-FR"') !== -1 || /"audio_locales":\[[^\]]*"fr-FR"/.test(raw)
        };
    } catch (e) {
        return null;
    }
}

async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let i = 0;
    async function worker() {
        while (i < items.length) {
            const idx = i++;
            results[idx] = await fn(items[idx], idx);
        }
    }
    await Promise.all(Array.from({ length: limit }, worker));
    return results;
}

(async () => {
    const src = fs.readFileSync(path, "utf8");
    const catalog = JSON.parse(src.replace(/^const DEFAULT_ANIME_DATA = /, "").replace(/;\s*$/, ""));
    const token = await getAnonToken();
    console.log("Jeton anonyme OK");

    const withCr = catalog.filter((a) => a.crunchyrollUrl);
    console.log("Séries Crunchyroll à vérifier:", withCr.length);

    let dead = 0, alive = 0, unknown = 0;
    await mapLimit(withCr, 5, async (anime) => {
        const resolved = await resolveSeriesId(anime.crunchyrollUrl);
        if (resolved === null) { unknown++; return; }
        if (resolved.dead) {
            console.log("  MORT (404):", anime.titleFr);
            anime.crunchyrollUrl = null;
            dead++;
            return;
        }
        const check = await checkSeries(token, resolved.id);
        if (check === null) { unknown++; return; }
        if (check.episodes) {
            alive++;
            // Canoniser l'URL au passage (vieux format -> format série actuel)
            if (resolved.finalUrl && resolved.finalUrl !== anime.crunchyrollUrl) {
                anime.crunchyrollUrl = resolved.finalUrl;
            }
            anime.crVf = check.vf; // doublage VF réel sur Crunchyroll ?
            if (!check.vf) console.log("  PAS DE VF sur CR:", anime.titleFr);
        } else {
            console.log("  SANS ÉPISODES:", anime.titleFr, "(" + resolved.id + ")");
            anime.crunchyrollUrl = null;
            dead++;
        }
    });
    console.log(`Vivantes: ${alive} | retirées: ${dead} | indéterminées (conservées): ${unknown}`);

    // Marquage "pas de doublage VF" : ADN garantit la VF (catalogue filtré),
    // Crunchyroll vérifié via crVf. Sans aucune source VF => noVf.
    let noVf = 0;
    for (const anime of catalog) {
        const vfOnCr = anime.crunchyrollUrl && anime.crVf !== false;
        const vfOnAdn = !!anime.adnUrl;
        if (!vfOnCr && !vfOnAdn) {
            anime.noVf = true;
            noVf++;
        } else {
            delete anime.noVf;
        }
        delete anime.crVf;
    }
    console.log("Animés sans doublage VF (retirés du classement):", noVf);

    let unavailable = 0;
    for (const anime of catalog) {
        if (!anime.crunchyrollUrl && !anime.adnUrl && !anime.netflixUrl && !anime.disneyUrl && !anime.primeUrl) {
            anime.unavailable = true;
            unavailable++;
        } else {
            delete anime.unavailable;
        }
    }
    console.log("Animés grisés (aucune plateforme):", unavailable);

    fs.writeFileSync(path, "const DEFAULT_ANIME_DATA = " + JSON.stringify(catalog, null, 2) + ";\n", "utf8");
    console.log("catalog.js mis à jour.");
})();
