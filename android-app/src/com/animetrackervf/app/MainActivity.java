package com.animetrackervf.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {

    private static final String APP_URL = "https://energiecraftonline-afk.github.io/anime-tracker-vf/";
    private static final String APP_HOST = "energiecraftonline-afk.github.io";

    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        // Cache local : DOM storage (localStorage), base de données et cache HTTP.
        // Le service worker du site (sw.js) est aussi actif dans le WebView et
        // pre-cache toutes les ressources pour un usage hors-ligne.
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost();
                String path = uri.getPath() == null ? "" : uri.getPath();

                // Page d'autorisation Discord : ouvrir l'app Discord installée
                // (deep link) pour autoriser sans retaper de mot de passe. Le
                // retour se fait via animetrackervf://callback (voir manifest).
                boolean isDiscordAuthorize = host != null
                        && (host.equals("discord.com") || host.endsWith(".discord.com"))
                        && path.contains("/oauth2/authorize");
                if (isDiscordAuthorize) {
                    Uri target = uri;
                    if (path.startsWith("/api/")) {
                        // /api/oauth2/authorize -> /oauth2/authorize : l'app Discord
                        // ne gère le deep link que sur ce second chemin.
                        target = Uri.parse(uri.toString().replace("/api/oauth2/authorize", "/oauth2/authorize"));
                    }
                    // 1. Forcer l'app Discord si elle est installée et accepte ce lien
                    Intent discordApp = new Intent(Intent.ACTION_VIEW, target);
                    discordApp.setPackage("com.discord");
                    try {
                        startActivity(discordApp);
                    } catch (Exception notHandledByDiscordApp) {
                        // 2. Sinon : navigateur (session Discord web souvent déjà active)
                        try {
                            startActivity(new Intent(Intent.ACTION_VIEW, target));
                        } catch (Exception ignored) {
                        }
                    }
                    return true;
                }

                if (host != null && (host.equals(APP_HOST)
                        // Reste du flux Supabase / Discord : rester dans le WebView
                        || host.endsWith(".supabase.co")
                        || host.equals("discord.com")
                        || host.endsWith(".discord.com"))) {
                    return false; // navigation interne dans le WebView
                }
                // Liens externes (Crunchyroll, ADN...) -> navigateur / app dédiée
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (Exception ignored) {
                }
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient());

        setContentView(webView);

        if (!handleAuthDeepLink(getIntent())) {
            if (savedInstanceState != null) {
                webView.restoreState(savedInstanceState);
            } else {
                webView.loadUrl(APP_URL);
            }
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleAuthDeepLink(intent);
    }

    // Retour du login Discord : animetrackervf://callback#access_token=...
    // On recharge le site avec le fragment pour que supabase-js récupère la session.
    private boolean handleAuthDeepLink(Intent intent) {
        if (intent == null || intent.getData() == null) return false;
        Uri data = intent.getData();
        if (!"animetrackervf".equals(data.getScheme())) return false;
        String fragment = data.getFragment();
        webView.loadUrl(fragment != null && !fragment.isEmpty() ? APP_URL + "#" + fragment : APP_URL);
        return true;
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
        }
        super.onDestroy();
    }
}
