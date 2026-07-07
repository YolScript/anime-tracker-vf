// ==UserScript==
// @name         Crunchyroll History Exporter for CrunchyTracker
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Exporte votre historique de visionnage Crunchyroll sous forme de fichier JSON compatible avec CrunchyTracker.
// @author       Antigravity AI
// @match        https://www.crunchyroll.com/*/history*
// @match        https://www.crunchyroll.com/history*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Attendre que la page soit complètement chargée
    window.addEventListener('load', () => {
        setTimeout(createExportButton, 3000);
    });

    function createExportButton() {
        if (document.getElementById('crunchy-tracker-exporter-btn')) return;

        const btn = document.createElement('button');
        btn.id = 'crunchy-tracker-exporter-btn';
        btn.innerHTML = `
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 8px; vertical-align: middle;"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
            Exporter vers CrunchyTracker
        `;
        
        // Styles du bouton
        Object.assign(btn.style, {
            position: 'fixed',
            bottom: '24px',
            right: '24px',
            backgroundColor: '#ff6400',
            color: '#000000',
            border: 'none',
            borderRadius: '24px',
            padding: '12px 20px',
            fontSize: '14px',
            fontWeight: 'bold',
            cursor: 'pointer',
            boxShadow: '0 8px 24px rgba(255, 100, 0, 0.4)',
            zIndex: '99999',
            fontFamily: 'sans-serif',
            transition: 'transform 0.2s, background-color 0.2s',
            display: 'flex',
            align-items: 'center'
        });

        btn.onmouseover = () => {
            btn.style.backgroundColor = '#ff8533';
            btn.style.transform = 'scale(1.05)';
        };
        btn.onmouseout = () => {
            btn.style.backgroundColor = '#ff6400';
            btn.style.transform = 'scale(1)';
        };

        btn.addEventListener('click', scrapeAndExport);
        document.body.appendChild(btn);
    }

    function scrapeAndExport() {
        const historyItems = document.querySelectorAll('div.history-item, div.playable-card, article.playable-card'); // Sélecteurs communs pour Crunchyroll
        
        if (historyItems.length === 0) {
            // Tentative alternative de sélection sur la structure de page actuelle
            const alternativeItems = document.querySelectorAll('[data-test="playable-card"], .history-card, .playable-card');
            if (alternativeItems.length > 0) {
                processCards(alternativeItems);
                return;
            }
            alert("Aucun élément d'historique détecté sur cette page. Assurez-vous d'être bien connecté et sur la page de votre Historique.");
            return;
        }
        processCards(historyItems);
    }

    function processCards(cards) {
        const exportedData = [];
        
        cards.forEach(card => {
            try {
                // Recherche du titre de la série
                const seriesTitleEl = card.querySelector('.series-title, [class*="series-title"], .playable-card__series-title');
                const epTitleEl = card.querySelector('.episode-title, [class*="episode-title"], .playable-card__title');
                const progressFillEl = card.querySelector('.progress-bar__fill, [class*="progress-fill"], [class*="bar-fill"]');
                
                if (!seriesTitleEl) return;
                
                const titleFr = seriesTitleEl.textContent.trim();
                let episodeNum = 1;
                
                // Recherche du numéro d'épisode dans le texte (ex: "E5 - Épisode 5")
                const epText = epTitleEl ? epTitleEl.textContent : '';
                const epMatch = epText.match(/(?:Épisode|Ep|E)\s*(\d+)/i) || titleFr.match(/(?:Épisode|Ep|E)\s*(\d+)/i);
                if (epMatch) {
                    episodeNum = parseInt(epMatch[1]);
                }
                
                // Calcul si l'épisode a été terminé en fonction de la barre de progression
                let pct = 0;
                if (progressFillEl) {
                    const styleWidth = progressFillEl.style.width || '';
                    pct = parseInt(styleWidth) || 0;
                }
                
                // Si la barre de progression est supérieure à 80%, on considère l'épisode comme vu
                // Sinon, on prend l'épisode précédent comme dernier vu
                let episodesWatched = episodeNum;
                if (progressFillEl && pct < 80) {
                    episodesWatched = Math.max(0, episodeNum - 1);
                }

                exportedData.push({
                    titleFr: titleFr,
                    episodesWatched: episodesWatched,
                    status: episodesWatched > 0 ? "watching" : "plan-to-watch"
                });
            } catch (e) {
                console.error("Erreur lors de la lecture d'une carte :", e);
            }
        });
        
        if (exportedData.length === 0) {
            alert("Impossible d'extraire les données d'historique. Crunchyroll a peut-être modifié son code source.");
            return;
        }

        // Éliminer les doublons (garder l'épisode le plus élevé vu pour chaque série)
        const uniqueHistory = {};
        exportedData.forEach(item => {
            const existing = uniqueHistory[item.titleFr];
            if (!existing || item.episodesWatched > existing.episodesWatched) {
                uniqueHistory[item.titleFr] = item;
            }
        });

        const finalData = Object.values(uniqueHistory);

        // Lancer le téléchargement du fichier JSON
        const dataStr = JSON.stringify(finalData, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `crunchyroll_history_${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(a);
        a.click();
        
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        alert(`Historique extrait avec succès ! ${finalData.length} animés prêts à être importés dans CrunchyTracker.`);
    }
})();
