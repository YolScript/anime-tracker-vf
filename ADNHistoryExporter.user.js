// ==UserScript==
// @name         ADN → Anime Tracker VF (Sync Historique)
// @namespace    https://anime-tracker-vf.web.app
// @version      1.0
// @description  Synchronise automatiquement votre historique ADN (Animation Digital Network) vers Anime Tracker VF.
// @author       Anime Tracker VF
// @match        https://animationdigitalnetwork.fr/*
// @match        https://www.animationdigitalnetwork.fr/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const ADN_API_BASE = "https://gw.api.animationdigitalnetwork.fr";

    // =====================================================================
    // 1. Récupérer le token JWT depuis la session ADN
    // =====================================================================
    function getAdnToken() {
        // ADN stocke le token dans le localStorage
        const keys = Object.keys(localStorage);
        for (const key of keys) {
            try {
                const val = localStorage.getItem(key);
                if (!val) continue;

                // Chercher un JWT (commence par eyJ)
                if (val.startsWith("eyJ")) {
                    return val;
                }

                // Chercher dans un objet JSON
                const parsed = JSON.parse(val);
                if (parsed.accessToken) return parsed.accessToken;
                if (parsed.access_token) return parsed.access_token;
                if (parsed.token) return parsed.token;
                if (parsed.jwt) return parsed.jwt;
            } catch (e) { /* ignore non-JSON */ }
        }

        // Chercher dans les cookies
        const cookies = document.cookie.split(";");
        for (const cookie of cookies) {
            const [name, value] = cookie.trim().split("=");
            if (value && value.startsWith("eyJ")) {
                return decodeURIComponent(value);
            }
        }

        return null;
    }

    // =====================================================================
    // 2. Récupérer l'historique / la liste de visionnage depuis l'API ADN
    // =====================================================================
    async function fetchAdnHistory(token) {
        const allItems = [];

        // Essayer plusieurs endpoints connus
        const endpoints = [
            "/player/history?limit=200&offset=0",
            "/user/history?limit=200&offset=0",
            "/playback/history?limit=200",
            "/video/history?limit=200"
        ];

        for (const endpoint of endpoints) {
            try {
                const resp = await fetch(ADN_API_BASE + endpoint, {
                    credentials: "include",
                    headers: {
                        "Authorization": "Bearer " + token,
                        "Accept": "application/json",
                        "X-Target-Distribution": "fr",
                        "Content-Type": "application/json"
                    }
                });

                if (resp.ok) {
                    const data = await resp.json();
                    const items = data.videos || data.items || data.history || data.data || data;

                    if (Array.isArray(items) && items.length > 0) {
                        allItems.push(...items);
                        console.log(`[ADN Sync] Endpoint ${endpoint} → ${items.length} éléments`);
                        break; // On a trouvé le bon endpoint
                    }
                }
            } catch (e) {
                console.log(`[ADN Sync] Endpoint ${endpoint} échoué:`, e.message);
            }
        }

        return allItems;
    }

    // =====================================================================
    // 3. Méthode alternative : scraping de la page historique
    // =====================================================================
    function scrapeHistoryPage() {
        const results = [];

        // Sélecteurs possibles pour les cartes d'historique ADN
        const selectors = [
            ".history-card",
            ".video-card",
            "[class*='history']",
            "[class*='watched']",
            ".card",
            "article"
        ];

        let cards = [];
        for (const sel of selectors) {
            const found = document.querySelectorAll(sel);
            if (found.length > 3) { // Au moins quelques résultats
                cards = found;
                break;
            }
        }

        cards.forEach(card => {
            try {
                // Chercher le titre
                const titleEl = card.querySelector("h2, h3, h4, [class*='title'], .card-title");
                if (!titleEl) return;

                const title = titleEl.textContent.trim();

                // Chercher le numéro d'épisode
                const epEl = card.querySelector("[class*='episode'], [class*='ep-num'], .subtitle");
                let episodeNum = 1;
                if (epEl) {
                    const epMatch = epEl.textContent.match(/(?:épisode|ep\.?|e)\s*(\d+)/i);
                    if (epMatch) episodeNum = parseInt(epMatch[1]);
                }

                // Chercher la barre de progression
                const progressEl = card.querySelector("[class*='progress'] [class*='fill'], [class*='progress-bar']");
                let progress = 100;
                if (progressEl) {
                    const width = progressEl.style.width;
                    if (width) progress = parseInt(width) || 100;
                }

                // Détecter si c'est de la VF
                let isVf = true;
                if (/\b(VOSTFR|VO|Japanese|ja)\b/i.test(title) || (epEl && /\b(VOSTFR|VO|Japanese|ja)\b/i.test(epEl.textContent))) {
                    isVf = false;
                }

                if (!isVf) return; // Ne garder que le doublage FR (VF)

                // Considérer comme vu si progression > 80%
                if (progress >= 80) {
                    results.push({
                        titleFr: title,
                        episodeNum: episodeNum
                    });
                }
            } catch (e) { /* ignore */ }
        });

        return results;
    }

    // =====================================================================
    // 4. Transformer les données pour Anime Tracker VF
    // =====================================================================
    function transformToTrackerFormat(items) {
        const seriesMap = {};

        items.forEach(item => {
            // Format API
            const title = item.showTitle || item.show_title || item.seriesTitle
                || item.series_title || item.name || item.title || item.titleFr || "";

            if (!title) return;

            const episodeNumber = item.episodeNumber || item.episode_number
                || item.number || item.episodeNum || 0;

            const showSlug = item.showSlug || item.show_slug || item.slug || "";
            const showId = item.showId || item.show_id || item.id || "";

            const key = title.toLowerCase().trim();

            if (!seriesMap[key]) {
                seriesMap[key] = {
                    titleFr: title,
                    maxEpisode: 0,
                    adnUrl: showSlug
                        ? `https://animationdigitalnetwork.fr/video/${showSlug}`
                        : (showId ? `https://animationdigitalnetwork.fr/video/${showId}` : "")
                };
            }

            // Détecter si c'est de la VF (par défaut true, sauf si présence de VOSTFR/VO dans le titre ou langue japonaise)
            let isVf = true;
            const videoTitle = item.videoTitle || item.title || item.name || "";
            const language = item.language || "";
            if (/\b(VOSTFR|VO|Japanese|ja)\b/i.test(videoTitle) || /\b(ja|japanese)\b/i.test(language)) {
                isVf = false;
            }

            if (!isVf) return; // Ne garder que le doublage FR (VF)

            seriesMap[key].maxEpisode = Math.max(
                seriesMap[key].maxEpisode,
                parseInt(episodeNumber) || 0
            );

            seriesMap[key].audio = "vf";
        });

        const result = [];
        Object.values(seriesMap).forEach(series => {
            if (series.maxEpisode > 0) {
                result.push({
                    titleFr: series.titleFr,
                    episodesWatched: series.maxEpisode,
                    adnUrl: series.adnUrl,
                    audio: "vf",
                    source: "adn"
                });
            }
        });

        return result;
    }

    // =====================================================================
    // 5. Interface utilisateur — Bouton de synchronisation
    // =====================================================================
    function createSyncButton() {
        if (document.getElementById("anime-tracker-adn-sync-btn")) return;

        const btn = document.createElement("button");
        btn.id = "anime-tracker-adn-sync-btn";
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px; vertical-align: middle;">
                <polyline points="23 4 23 10 17 10"></polyline>
                <polyline points="1 20 1 14 7 14"></polyline>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
            </svg>
            Sync → Anime Tracker VF
        `;

        Object.assign(btn.style, {
            position: "fixed",
            bottom: "24px",
            right: "24px",
            backgroundColor: "#00a8e8",
            color: "#ffffff",
            border: "none",
            borderRadius: "24px",
            padding: "12px 20px",
            fontSize: "14px",
            fontWeight: "bold",
            cursor: "pointer",
            boxShadow: "0 8px 24px rgba(0, 168, 232, 0.4)",
            zIndex: "99999",
            fontFamily: "'Outfit', sans-serif",
            transition: "transform 0.2s, background-color 0.2s",
            display: "flex",
            alignItems: "center"
        });

        btn.onmouseover = () => {
            btn.style.backgroundColor = "#33b9ed";
            btn.style.transform = "scale(1.05)";
        };
        btn.onmouseout = () => {
            btn.style.backgroundColor = "#00a8e8";
            btn.style.transform = "scale(1)";
        };

        btn.addEventListener("click", runAdnSync);
        document.body.appendChild(btn);
    }

    // =====================================================================
    // 6. Exécution de la synchronisation
    // =====================================================================
    async function runAdnSync() {
        const btn = document.getElementById("anime-tracker-adn-sync-btn");
        const originalText = btn.innerHTML;

        btn.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px; vertical-align: middle; animation: atkSpin 1s linear infinite;">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M12 6v6l4 2"></path>
            </svg>
            Synchronisation...
        `;
        btn.disabled = true;
        btn.style.opacity = "0.7";

        // Ajouter l'animation
        if (!document.getElementById("anime-tracker-spin-style")) {
            const style = document.createElement("style");
            style.id = "anime-tracker-spin-style";
            style.textContent = "@keyframes atkSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }";
            document.head.appendChild(style);
        }

        // Ouvrir l'onglet tout de suite, encore dans le geste utilisateur du
        // clic : les "await fetch" ci-dessous (plusieurs endpoints testés en
        // séquence) consomment sinon l'activation utilisateur et le
        // window.open() final vers le tracker est bloqué en silence par le
        // navigateur — cause la plus probable d'une sync qui ne se voit
        // jamais appliquée.
        let syncTab = null;
        try {
            syncTab = window.open("about:blank", "_blank");
            if (syncTab) {
                syncTab.document.write("<title>Anime Tracker VF</title><body style='background:#0e0f13;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;'>Synchronisation en cours…</body>");
            }
        } catch (e) { /* ignore */ }

        try {
            let trackerData = [];

            // Essai 1 : Via l'API avec le token
            const token = getAdnToken();
            if (token) {
                console.log("[ADN Sync] Token trouvé, tentative API...");
                const history = await fetchAdnHistory(token);

                if (history.length > 0) {
                    trackerData = transformToTrackerFormat(history);
                }
            }

            // Essai 2 : Scraping de la page si on est sur la page d'historique
            if (trackerData.length === 0) {
                console.log("[ADN Sync] Tentative scraping de la page...");
                const scraped = scrapeHistoryPage();

                if (scraped.length > 0) {
                    // Regrouper par série
                    const seriesMap = {};
                    scraped.forEach(item => {
                        const key = item.titleFr.toLowerCase().trim();
                        if (!seriesMap[key]) {
                            seriesMap[key] = {
                                titleFr: item.titleFr,
                                maxEpisode: 0
                            };
                        }
                        seriesMap[key].maxEpisode = Math.max(
                            seriesMap[key].maxEpisode,
                            item.episodeNum
                        );
                    });

                    trackerData = Object.values(seriesMap)
                        .filter(s => s.maxEpisode > 0)
                        .map(s => ({
                            titleFr: s.titleFr,
                            episodesWatched: s.maxEpisode,
                            source: "adn"
                        }));
                }
            }

            if (trackerData.length === 0) {
                showNotification(
                    "⚠️ Aucun historique trouvé. Assurez-vous d'être connecté sur ADN et d'avoir visionné des épisodes.",
                    "warning"
                );
                if (syncTab) syncTab.close();
                resetButton(btn, originalText);
                return;
            }

            // Redirection de l'onglet déjà ouvert (voir plus haut) pour la
            // synchronisation automatique. Repli sur un window.open normal si
            // l'onglet a été fermé entre-temps ou n'a jamais pu s'ouvrir.
            try {
                const b64Data = btoa(unescape(encodeURIComponent(JSON.stringify(trackerData))));
                const trackerUrl = `https://yolscript.github.io/anime-tracker-vf/#sync-data=${b64Data}`;
                if (syncTab && !syncTab.closed) {
                    syncTab.location.href = trackerUrl;
                } else {
                    const fallbackTab = window.open(trackerUrl, "_blank");
                    if (!fallbackTab) {
                        showNotification("⚠️ Fenêtre bloquée par le navigateur : autorisez les popups pour ADN, ou importez le fichier téléchargé sur le site.", "warning");
                    }
                }
            } catch (e) {
                console.error("[ADN Sync] Erreur redirection auto-sync:", e);
            }

            // Télécharger le fichier JSON (fallback)
            const dataStr = JSON.stringify(trackerData, null, 2);
            const blob = new Blob([dataStr], { type: "application/json" });
            const url = URL.createObjectURL(blob);

            const a = document.createElement("a");
            a.href = url;
            a.download = `adn_sync_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            showNotification(
                `✅ ${trackerData.length} animés synchronisés avec succès vers Anime Tracker VF !`,
                "success"
            );
        } catch (e) {
            console.error("[ADN Sync] Erreur:", e);
            showNotification("❌ Erreur lors de la synchronisation : " + e.message, "error");
            if (syncTab && !syncTab.closed) syncTab.close();
        }

        resetButton(btn, originalText);
    }

    function resetButton(btn, originalText) {
        btn.innerHTML = originalText;
        btn.disabled = false;
        btn.style.opacity = "1";
    }

    // =====================================================================
    // 7. Notification visuelle
    // =====================================================================
    function showNotification(message, type) {
        const existing = document.getElementById("anime-tracker-notif");
        if (existing) existing.remove();

        const notif = document.createElement("div");
        notif.id = "anime-tracker-notif";

        const bgColor = type === "success" ? "#22c55e"
            : type === "error" ? "#ef4444"
            : "#f59e0b";

        Object.assign(notif.style, {
            position: "fixed",
            top: "24px",
            right: "24px",
            backgroundColor: bgColor,
            color: "#fff",
            padding: "14px 20px",
            borderRadius: "12px",
            fontSize: "14px",
            fontWeight: "600",
            fontFamily: "'Outfit', sans-serif",
            zIndex: "100000",
            maxWidth: "400px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
            transition: "opacity 0.3s, transform 0.3s",
            cursor: "pointer"
        });

        notif.textContent = message;
        notif.addEventListener("click", () => notif.remove());
        document.body.appendChild(notif);

        setTimeout(() => {
            notif.style.opacity = "0";
            notif.style.transform = "translateY(-10px)";
            setTimeout(() => notif.remove(), 300);
        }, 6000);
    }

    // =====================================================================
    // Initialisation
    // =====================================================================
    if (document.readyState === "complete") {
        setTimeout(createSyncButton, 2000);
    } else {
        window.addEventListener("load", () => setTimeout(createSyncButton, 2000));
    }
})();
