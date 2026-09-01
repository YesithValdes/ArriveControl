package com.kupocell.arrivecontrol;

import com.getcapacitor.BridgeActivity;

/**
 * La app es un cascarón: el WebView carga la web remota y se actualiza sola.
 *
 * Lo único que se cambia aquí es de dónde salen los modelos faciales —del
 * APK y no de la red— para que la primera arrancada en un aparato nuevo no
 * se vaya en bajar 25 MB. Ver ModelosLocales.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onStart() {
        super.onStart();
        // Después de super.onStart(): antes de eso `bridge` todavía no existe.
        bridge.setWebViewClient(new ModelosLocales(bridge));
    }
}
