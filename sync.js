// ==========================================================================
// SYNC DISCORD (via Supabase) — synchronise la progression entre appareils
// ==========================================================================
// Configuration : remplir les deux valeurs ci-dessous après avoir créé le
// projet Supabase (Settings > API). Tant qu'elles sont vides, le bouton
// Discord reste masqué et le site fonctionne comme avant (localStorage seul).
const SUPABASE_URL = "";
const SUPABASE_ANON_KEY = "";

const SYNC_STORAGE_KEY = "crunchy_tracker_progress_v2";
const SYNC_TABLE = "anime_progress";

let sbClient = null;
let syncUser = null;
let syncPushTimer = null;
let lastPushedJson = null;

function isSyncConfigured() {
    return SUPABASE_URL !== "" && SUPABASE_ANON_KEY !== "" && typeof supabase !== "undefined";
}

// ---------- Fusion des progressions (local + cloud) ----------
// Pour chaque animé : max d'épisodes vus, meilleure note, statut le plus avancé.
function mergeProgress(local, cloud) {
    const statusRank = {
        "completed": 4,
        "watching": 3,
        "hidden": 2,
        "on-hold": 1,
        "plan-to-watch": 0
    };
    const merged = { ...cloud };
    Object.keys(local).forEach((id) => {
        const l = local[id];
        const c = merged[id];
        if (!c) {
            merged[id] = l;
            return;
        }
        if (l.isCustom || c.isCustom) {
            // Animé ajouté manuellement : garder la version la plus avancée
            merged[id] = (l.episodesWatched || 0) >= (c.episodesWatched || 0) ? l : c;
            return;
        }
        merged[id] = {
            episodesWatched: Math.max(l.episodesWatched || 0, c.episodesWatched || 0),
            rating: Math.max(l.rating || 0, c.rating || 0),
            status: (statusRank[l.status] || 0) >= (statusRank[c.status] || 0) ? l.status : c.status
        };
    });
    return merged;
}

// ---------- Cloud <-> localStorage ----------
async function pullAndMergeFromCloud(showFeedback) {
    if (!sbClient || !syncUser) return;
    const { data, error } = await sbClient
        .from(SYNC_TABLE)
        .select("data")
        .eq("user_id", syncUser.id)
        .maybeSingle();
    if (error) {
        console.error("[Sync] Erreur de lecture cloud:", error);
        if (showFeedback) showToast("Erreur de synchronisation Discord.", "error");
        return;
    }
    const cloud = (data && data.data) ? data.data : {};
    let local = {};
    try {
        local = JSON.parse(localStorage.getItem(SYNC_STORAGE_KEY) || "{}");
    } catch (e) { /* localStorage corrompu : on repart du cloud */ }

    const merged = mergeProgress(local, cloud);
    localStorage.setItem(SYNC_STORAGE_KEY, JSON.stringify(merged));
    await pushToCloud();

    // Recharger l'interface avec les données fusionnées
    if (typeof loadData === "function") {
        loadData();
        if (typeof updateStats === "function") updateStats();
        if (typeof renderGrid === "function") renderGrid();
    }
    if (showFeedback) showToast("Progression synchronisée avec Discord !", "success");
}

async function pushToCloud() {
    if (!sbClient || !syncUser) return;
    const json = localStorage.getItem(SYNC_STORAGE_KEY) || "{}";
    if (json === lastPushedJson) return;
    const { error } = await sbClient.from(SYNC_TABLE).upsert({
        user_id: syncUser.id,
        data: JSON.parse(json),
        updated_at: new Date().toISOString()
    });
    if (error) {
        console.error("[Sync] Erreur d'écriture cloud:", error);
    } else {
        lastPushedJson = json;
    }
}

function schedulePush() {
    if (!syncUser) return;
    clearTimeout(syncPushTimer);
    syncPushTimer = setTimeout(pushToCloud, 2000);
}

// ---------- Interface du bouton ----------
function updateDiscordUi() {
    const btn = document.getElementById("discord-login-btn");
    const label = document.getElementById("discord-btn-label");
    const avatar = document.getElementById("discord-btn-avatar");
    if (!btn) return;
    btn.style.display = "flex";
    if (syncUser) {
        const meta = syncUser.user_metadata || {};
        const name = meta.custom_claims && meta.custom_claims.global_name
            ? meta.custom_claims.global_name
            : (meta.full_name || meta.name || "Discord");
        if (label) label.textContent = name;
        if (avatar && meta.avatar_url) {
            avatar.src = meta.avatar_url;
            avatar.style.display = "block";
        }
        btn.classList.add("connected");
        btn.title = "Synchronisation Discord active — cliquer pour se déconnecter";
    } else {
        if (label) label.textContent = "Discord";
        if (avatar) avatar.style.display = "none";
        btn.classList.remove("connected");
        btn.title = "Connecter Discord pour synchroniser PC et téléphone";
    }
}

// ---------- Initialisation ----------
function initDiscordSync() {
    const btn = document.getElementById("discord-login-btn");
    if (!isSyncConfigured()) {
        if (btn) btn.style.display = "none";
        return;
    }
    sbClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    btn.addEventListener("click", async () => {
        if (syncUser) {
            if (confirm("Se déconnecter de Discord ? (vos données restent sur cet appareil)")) {
                await sbClient.auth.signOut();
            }
            return;
        }
        await sbClient.auth.signInWithOAuth({
            provider: "discord",
            options: { redirectTo: window.location.origin + window.location.pathname }
        });
    });

    sbClient.auth.onAuthStateChange((event, session) => {
        const wasConnected = !!syncUser;
        syncUser = session ? session.user : null;
        lastPushedJson = null;
        updateDiscordUi();
        if (syncUser && !wasConnected) {
            pullAndMergeFromCloud(true);
        }
    });

    // Envoyer les modifications locales vers le cloud après chaque sauvegarde
    if (typeof saveData === "function") {
        const originalSaveData = saveData;
        saveData = function (...args) {
            const result = originalSaveData.apply(this, args);
            schedulePush();
            return result;
        };
    }

    // Re-synchroniser quand on revient sur l'onglet / l'app
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden && syncUser) pullAndMergeFromCloud(false);
    });

    updateDiscordUi();
}

window.addEventListener("load", initDiscordSync);
