// Remplace les dates de mise en ligne plateforme (ADN/CR) par les VRAIES
// dates de diffusion originale (AniList), pour les entrées adn-* et cr-*.
// Complète aussi trailer/note/genres quand absents.
const fs = require("fs");
const path = require("path").join(__dirname, "..", "catalog.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const QUERY = `query($search:String){Media(search:$search,type:ANIME){
id countryOfOrigin averageScore genres
title{romaji english native}
startDate{year month day} endDate{year month day}
trailer{id site} episodes status}}`;

function normTitle(s) {
    return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function toFrDate(d) {
    if (!d || !d.year) return null;
    const p = (n) => String(n || 1).padStart(2, "0");
    return `${p(d.day)}/${p(d.month)}/${d.year}`;
}

async function anilistLookup(title) {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const res = await fetch("https://graphql.anilist.co", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query: QUERY, variables: { search: title } })
            });
            if (res.status === 429) { await sleep(10000); continue; }
            if (!res.ok) return null;
            const json = await res.json();
            return json.data ? json.data.Media : null;
        } catch (e) { await sleep(2000); }
    }
    return null;
}

(async () => {
    const src = fs.readFileSync(path, "utf8");
    const catalog = JSON.parse(src.replace(/^const DEFAULT_ANIME_DATA = /, "").replace(/;\s*$/, ""));

    const targets = catalog.filter(a => /^(adn|cr)-/.test(a.id));
    console.log("Fiches plateformes à corriger:", targets.length);

    let fixed = 0, noMatch = 0, done = 0;
    for (const anime of targets) {
        done++;
        const media = await anilistLookup(anime.titleOrig || anime.titleFr);
        await sleep(700);
        if (!media || media.countryOfOrigin !== "JP") { noMatch++; continue; }

        // Match strict du titre pour éviter les fausses correspondances
        const wanted = [normTitle(anime.titleFr), normTitle(anime.titleOrig)];
        const got = [normTitle(media.title && media.title.romaji), normTitle(media.title && media.title.english)];
        const strictMatch = wanted.some(w => w && got.some(g => g && (g === w || g.indexOf(w) === 0 || w.indexOf(g) === 0)));
        if (!strictMatch) { noMatch++; continue; }

        if (media.startDate && media.startDate.year) {
            anime.rawStartDate = media.startDate;
            anime.releaseDate = toFrDate(media.startDate);
        }
        if (media.endDate && media.endDate.year) {
            anime.rawEndDate = media.endDate;
            anime.lastEpisodeDate = toFrDate(media.endDate);
        }
        if (!anime.trailerId && media.trailer && media.trailer.site === "youtube") {
            anime.trailerId = media.trailer.id;
        }
        if (!anime.siteRating && media.averageScore) {
            anime.siteRating = (media.averageScore / 20).toFixed(1);
        }
        fixed++;

        if (done % 50 === 0) {
            console.log(`${done}/${targets.length} — corrigées: ${fixed}`);
            fs.writeFileSync(path, "const DEFAULT_ANIME_DATA = " + JSON.stringify(catalog, null, 2) + ";\n", "utf8");
        }
    }

    fs.writeFileSync(path, "const DEFAULT_ANIME_DATA = " + JSON.stringify(catalog, null, 2) + ";\n", "utf8");
    console.log(`TERMINÉ — dates corrigées: ${fixed}, sans correspondance sûre: ${noMatch}`);
})();
