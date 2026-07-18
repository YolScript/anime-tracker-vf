// Récupère l'opening vidéo (creditless, animethemes.moe) de chaque animé
// du catalogue et l'enregistre dans le champ "openingUrl".
const fs = require("fs");
const path = require("path").join(__dirname, "..", "catalog.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pickOpeningUrl(animeEntry) {
    if (!animeEntry || !Array.isArray(animeEntry.animethemes)) return null;
    const ops = animeEntry.animethemes
        .filter((t) => t.type === "OP")
        .sort((a, b) => (a.sequence || 1) - (b.sequence || 1));
    for (const op of ops) {
        for (const entry of op.animethemeentries || []) {
            if (entry.nsfw || entry.spoiler) continue;
            const videos = (entry.videos || [])
                .filter((v) => v.link && v.overlap === "None")
                .sort((a, b) => (b.resolution || 0) - (a.resolution || 0));
            if (videos.length > 0) return videos[0].link;
        }
    }
    return null;
}

async function fetchJson(url) {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const res = await fetch(url, { headers: { "User-Agent": "AnimeTrackerVF/1.0 (site de suivi personnel)" } });
            if (res.status === 429) { await sleep(5000); continue; }
            if (!res.ok) return null;
            return await res.json();
        } catch (e) {
            await sleep(2000);
        }
    }
    return null;
}

const INCLUDE = "include=animethemes.animethemeentries.videos";

async function byAnilistId(id) {
    const json = await fetchJson(`https://api.animethemes.moe/anime?filter[has]=resources&filter[site]=AniList&filter[external_id]=${id}&${INCLUDE}`);
    if (!json || !json.anime || json.anime.length === 0) return null;
    return pickOpeningUrl(json.anime[0]);
}

function normTitle(s) {
    return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

async function byTitle(anime) {
    for (const title of [anime.titleOrig, anime.titleFr]) {
        if (!title) continue;
        const json = await fetchJson(`https://api.animethemes.moe/search?q=${encodeURIComponent(title)}&fields[search]=anime&include[anime]=animethemes.animethemeentries.videos`);
        const results = json && json.search && json.search.anime ? json.search.anime : [];
        if (results.length === 0) continue;
        // N'accepter que les correspondances de titre serrées (éviter les faux openings)
        const wanted = normTitle(title);
        const match = results.find((r) => normTitle(r.name) === wanted) || (normTitle(results[0].name).indexOf(wanted) !== -1 || wanted.indexOf(normTitle(results[0].name)) !== -1 ? results[0] : null);
        if (match) {
            const url = pickOpeningUrl(match);
            if (url) return url;
        }
        await sleep(700);
    }
    return null;
}

(async () => {
    const src = fs.readFileSync(path, "utf8");
    const catalog = JSON.parse(src.replace(/^const DEFAULT_ANIME_DATA = /, "").replace(/;\s*$/, ""));
    console.log("Catalogue:", catalog.length);

    let found = 0, missing = 0, done = 0;
    for (const anime of catalog) {
        done++;
        if (anime.openingUrl) { found++; continue; }
        let url = null;
        const m = anime.id.match(/^franchise-(\d+)$/);
        if (m) {
            url = await byAnilistId(m[1]);
        }
        if (!url) {
            url = await byTitle(anime);
        }
        if (url) {
            anime.openingUrl = url;
            found++;
        } else {
            missing++;
        }
        if (done % 25 === 0) {
            console.log(`${done}/${catalog.length} traités — openings: ${found}, absents: ${missing}`);
            fs.writeFileSync(path, "const DEFAULT_ANIME_DATA = " + JSON.stringify(catalog, null, 2) + ";\n", "utf8");
        }
        await sleep(700);
    }

    fs.writeFileSync(path, "const DEFAULT_ANIME_DATA = " + JSON.stringify(catalog, null, 2) + ";\n", "utf8");
    console.log(`TERMINÉ : ${found} openings trouvés, ${missing} absents, total ${catalog.length}.`);
})();
