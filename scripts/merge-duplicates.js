// Fusionne les fiches quasi-doublons du catalogue : même franchise avec un
// suffixe de saison/partie/film dans le titre. La fiche au titre le plus
// court (la franchise) absorbe les URLs de plateformes et le max d'épisodes.
const fs = require("fs");
const path = "c:/Users/agora/Documents/Crunchyroll/catalog.js";

function normTitle(s) {
    return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

// Suffixes autorisés pour considérer deux titres comme la même franchise.
// Volontairement restrictif : "alternative", "spin-off" etc. restent séparés.
const SUFFIX_RE = /^(saison|season|seasons|part|partie|cour|final season|the final season|final|2nd season|3rd season|4th season|5th season|second season|third season|shippuden|next generations|brotherhood|movie|the movie|le film|film|ii|iii|iv|v|vi|[0-9]+|[0-9]+(st|nd|rd|th) season)(\s+(de\s+)?[0-9ivx]+)?$/;

// Franchises à fusion TOTALE : tout titre commençant par ce préfixe est
// absorbé par la fiche principale, quel que soit le suffixe (films, OAV...).
const FORCE_MERGE_PREFIXES = ["one piece", "fullmetal alchemist"];

function isSameFranchise(shortNorm, longNorm) {
    if (!longNorm.startsWith(shortNorm + " ")) return false;
    if (FORCE_MERGE_PREFIXES.indexOf(shortNorm) !== -1) return true;
    const rest = longNorm.slice(shortNorm.length).trim();
    return SUFFIX_RE.test(rest);
}

const PLATFORM_FIELDS = ["crunchyrollUrl", "adnUrl", "netflixUrl", "disneyUrl", "primeUrl"];

(async () => {
    const src = fs.readFileSync(path, "utf8");
    const catalog = JSON.parse(src.replace(/^const DEFAULT_ANIME_DATA = /, "").replace(/;\s*$/, ""));
    console.log("Catalogue avant fusion:", catalog.length);

    // Tri par longueur de titre normalisé : les franchises d'abord
    const entries = catalog.map((a) => ({ a, norm: normTitle(a.titleFr), normOrig: normTitle(a.titleOrig) }));
    entries.sort((x, y) => x.norm.length - y.norm.length);

    const absorbed = new Set();
    let merges = 0;
    for (let i = 0; i < entries.length; i++) {
        const main = entries[i];
        if (absorbed.has(main.a.id)) continue;
        for (let j = i + 1; j < entries.length; j++) {
            const cand = entries[j];
            if (absorbed.has(cand.a.id)) continue;
            const match =
                isSameFranchise(main.norm, cand.norm) ||
                (main.normOrig && isSameFranchise(main.normOrig, cand.normOrig)) ||
                main.norm === cand.norm; // doublon exact résiduel
            if (!match) continue;

            // Fusion : la fiche principale absorbe les plateformes manquantes
            for (const f of PLATFORM_FIELDS) {
                if (!main.a[f] && cand.a[f]) main.a[f] = cand.a[f];
            }
            main.a.episodesTotal = Math.max(main.a.episodesTotal || 1, cand.a.episodesTotal || 1);
            if (!main.a.openingUrl && cand.a.openingUrl) main.a.openingUrl = cand.a.openingUrl;
            if (!main.a.trailerId && cand.a.trailerId) main.a.trailerId = cand.a.trailerId;
            if ((!main.a.seasons || main.a.seasons.length === 0) && cand.a.seasons && cand.a.seasons.length > 0) {
                main.a.seasons = cand.a.seasons;
            }
            // Une plateforme VF trouvée quelque part : la fiche redevient visible
            if (PLATFORM_FIELDS.some((f) => main.a[f])) {
                delete main.a.noVf;
                delete main.a.unavailable;
            }
            absorbed.add(cand.a.id);
            merges++;
            console.log(`  FUSION: "${cand.a.titleFr}" -> "${main.a.titleFr}"`);
        }
    }

    const result = catalog.filter((a) => !absorbed.has(a.id));
    console.log(`Fusions: ${merges} | catalogue après: ${result.length}`);
    fs.writeFileSync(path, "const DEFAULT_ANIME_DATA = " + JSON.stringify(result, null, 2) + ";\n", "utf8");
    console.log("catalog.js mis à jour.");
})();
