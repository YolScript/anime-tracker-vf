// Normalisation de titre partagee par tous les scripts de scan (matching
// insensible aux accents/casse/ponctuation). Mutualisee ici : elle etait
// dupliquee indépendamment dans 6 fichiers, avec risque de divergence si
// un futur bug d'encodage n'etait corrige que dans certains d'entre eux.
function normTitle(s) {
    return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

module.exports = { normTitle };
