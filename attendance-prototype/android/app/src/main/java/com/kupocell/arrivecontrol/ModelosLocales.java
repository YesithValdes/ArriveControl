package com.kupocell.arrivecontrol;

import android.net.Uri;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Sirve los modelos faciales desde DENTRO de la APK en vez de bajarlos.
 *
 * La app es un cascarón: el WebView carga la web remota, que se actualiza
 * sola. Eso está bien para el código —pesa poco— pero los modelos son otra
 * cosa: la primera arrancada en cada aparato bajaba unos 25 MB comprimidos,
 * más de la mitad del modelo ArcFace. En 4G lento son unos 40 segundos
 * mirando una pantalla que no hace nada.
 *
 * Los modelos, a diferencia del código, casi nunca cambian. Así que viajan
 * dentro del APK y aquí se interceptan sus peticiones: la web pide
 * `/models/...` como siempre, sin enterarse de nada, y la respuesta sale del
 * disco del teléfono. La primera arrancada baja CERO.
 *
 * Si un archivo no está empaquetado se deja pasar a la red. Es a propósito:
 * publicar un modelo nuevo en la web tiene que seguir funcionando aunque la
 * APK instalada sea vieja — se baja esa vez y ya, en vez de reventar.
 */
public class ModelosLocales extends BridgeWebViewClient {

    /** Carpeta dentro de assets/ donde `scripts/empaquetar-modelos.mjs` deja todo. */
    private static final String RAIZ = "modelos";

    public ModelosLocales(Bridge bridge) {
        super(bridge);
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        WebResourceResponse local = desdeLaApk(view, request);
        return local != null ? local : super.shouldInterceptRequest(view, request);
    }

    /** La respuesta desde el APK, o null si esta petición no le corresponde. */
    private WebResourceResponse desdeLaApk(WebView view, WebResourceRequest request) {
        if (!"GET".equalsIgnoreCase(request.getMethod())) return null;

        Uri url = request.getUrl();
        String ruta = url.getPath();
        if (ruta == null) return null;
        // Solo lo pesado e inmutable. El HTML y las APIs jamás: de ellos vive
        // la actualización automática y los datos al día.
        if (!ruta.startsWith("/models/") && !ruta.startsWith("/wasm/")) return null;
        // Un `..` en la ruta se saldría de la carpeta de modelos.
        if (ruta.contains("..")) return null;

        try {
            InputStream datos = view.getContext().getAssets().open(RAIZ + ruta);
            Map<String, String> cabeceras = new HashMap<>();
            // Inmutables de verdad: van dentro del APK, cambian al actualizarla.
            cabeceras.put("Cache-Control", "public, max-age=31536000, immutable");
            // La web se sirve desde otro origen; sin esto una petición tratada
            // como cruzada (los .wasm de MediaPipe lo son) sería rechazada.
            cabeceras.put("Access-Control-Allow-Origin", "*");
            return new WebResourceResponse(tipoDe(ruta), null, 200, "OK", cabeceras, datos);
        } catch (IOException noEstaEmpaquetado) {
            return null; // que lo baje de la red, como antes
        }
    }

    /**
     * El tipo de contenido correcto. No es un detalle: `WebAssembly` solo
     * compila en streaming si la respuesta dice `application/wasm`, y con un
     * tipo equivocado el motor de reconocimiento no arranca.
     */
    private static String tipoDe(String ruta) {
        if (ruta.endsWith(".wasm")) return "application/wasm";
        if (ruta.endsWith(".mjs") || ruta.endsWith(".js")) return "text/javascript";
        if (ruta.endsWith(".json")) return "application/json";
        return "application/octet-stream"; // .bin, .onnx, .task
    }
}
