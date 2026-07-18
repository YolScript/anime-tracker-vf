// Valide les liens Netflix / Disney+ / Prime Video du catalogue.
// Un lien n'est retiré QUE sur 404/410 explicite (prudence sur le reste).
const fs = require("fs");
const { execFile } = require("child_process");
const path = require("path").join(__dirname, "..", "catalog.js");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpStatus(url) {
    return new Promise((resolve) => {
        execFile("curl", ["-s", "-o", process.platform === "win32" ? "NUL" : "/dev/null", "-w", "%{http_code}", "-L", "--max-redirs", "5", "-A", UA, "-H", "Accept-Language: fr-FR", url], (err, stdout) => {
            resolve(err ? null : (stdout || "").trim());
        });
    });
}

const FIELDS = ["netflixUrl", "disneyUrl", "primeUrl"];
const PLATFORM_FIELDS = ["crunchyrollUrl", "adnUrl", "netflixUrl", "disneyUrl", "primeUrl"];

(async () => {
    const src = fs.readFileSync(path, "utf8");
    const catalog = JSON.parse(src.replace(/^const DEFAULT_ANIME_DATA = /, "").replace(/;\s*$/, ""));

    let removed = 0, checked = 0;
    for (const anime of catalog) {
        for (const field of FIELDS) {
            if (!anime[field]) continue;
            const code = await httpStatus(anime[field]);
            checked++;
            await sleep(400);
            if (code === "404" || code === "410") {
                console.log(`  MORT (${code}) [${field}]:`, anime.titleFr, anime[field]);
                anime[field] = null;
                removed++;
            }
        }
    }

    // Recalcul : plus aucune plateforme => fiche exclue du classement VF
    let noVf = 0;
    for (const anime of catalog) {
        if (!PLATFORM_FIELDS.some((f) => anime[f])) {
            if (!anime.noVf) noVf++;
            anime.noVf = true;
            anime.unavailable = true;
        }
    }

    console.log(`Liens testés: ${checked} | retirés: ${removed} | fiches nouvellement exclues: ${noVf}`);
    fs.writeFileSync(path, "const DEFAULT_ANIME_DATA = " + JSON.stringify(catalog, null, 2) + ";\n", "utf8");
    console.log("catalog.js mis à jour.");
})();
