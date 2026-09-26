package com.kupocell.arrivecontrol;

import android.content.res.AssetManager;
import android.os.Bundle;
import android.util.Log;

import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import com.getcapacitor.BridgeActivity;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * La app es un cascarón: el WebView carga la web remota y se actualiza sola.
 *
 * Lo único que se cambia aquí es de dónde salen los modelos faciales —del
 * APK y no de la red— para que la primera arrancada en un aparato nuevo no
 * se vaya en bajar 25 MB. Ver ModelosLocales.
 */
public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // super.onCreate construye el bridge (BridgeActivity.load) y agenda la
        // carga de la web; el primer documento todavía no empezó.
        super.onCreate(savedInstanceState);
        anunciarModelosEmpaquetados();
    }

    @Override
    public void onStart() {
        super.onStart();
        // Después de super.onStart(): antes de eso `bridge` todavía no existe.
        bridge.setWebViewClient(new ModelosLocales(bridge));
    }

    /**
     * Le dice a la web QUÉ modelos trae esta APK: `window.__modelosEnApk`, la
     * lista de rutas (/models/..., /wasm/...). Con ella la web decide que su
     * service worker no toque esos archivos y los deje a ModelosLocales; si el
     * worker los interceptara, su fetch() iría por el ServiceWorkerClient de
     * Capacitor a la red y la APK sobraría.
     *
     * Solo se anuncia lo que de verdad está empaquetado: una APK compilada sin
     * `npm run apk` (carpeta vacía) o una vieja sin esta clase no anuncian nada,
     * y la web sigue guardando los modelos en su caché, como antes.
     *
     * Va en onCreate —una sola vez, antes de que cargue el primer documento—:
     * onStart corre en cada regreso a primer plano y apilaría scripts.
     */
    private void anunciarModelosEmpaquetados() {
        try {
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) return;
            List<String> rutas = new ArrayList<>();
            listar(getAssets(), "modelos", "", rutas);
            if (rutas.isEmpty()) return;
            StringBuilder js = new StringBuilder("window.__modelosEnApk=[");
            for (int i = 0; i < rutas.size(); i++) {
                if (i > 0) js.append(',');
                // Rutas de archivos propios (sin comillas ni barras invertidas).
                js.append('"').append(rutas.get(i).replace("\\", "").replace("\"", "")).append('"');
            }
            js.append("];");
            // Solo es una lista de rutas públicas: se puede anunciar a cualquier origen.
            WebViewCompat.addDocumentStartJavaScript(bridge.getWebView(), js.toString(), Collections.singleton("*"));
        } catch (Exception e) {
            // Sin anuncio la web se comporta como antes: nada se rompe.
            Log.w("ModelosLocales", "No se pudo anunciar los modelos empaquetados", e);
        }
    }

    /** Recorre assets/modelos y junta las rutas web ("/models/x.task") de cada archivo. */
    private static void listar(AssetManager assets, String raiz, String rel, List<String> rutas) throws IOException {
        String carpeta = rel.isEmpty() ? raiz : raiz + "/" + rel;
        String[] hijos = assets.list(carpeta);
        if (hijos == null || hijos.length == 0) {
            if (!rel.isEmpty()) rutas.add("/" + rel); // es un archivo
            return;
        }
        for (String h : hijos) listar(assets, raiz, rel.isEmpty() ? h : rel + "/" + h, rutas);
    }
}
