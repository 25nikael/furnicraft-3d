package com.furnicraft.app;

import android.os.Bundle;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Give the WebView the full screen and hide the status bar, like an
        // immersive app — the editor needs every pixel and the phone's clock/
        // icons were overlapping FurniCraft's own top bar. A swipe from the top
        // brings the status bar back transiently. The nav bar is left alone so
        // the gesture pill still works; the web layer pads for it via
        // env(safe-area-inset-bottom).
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (controller != null) {
            controller.hide(WindowInsetsCompat.Type.statusBars());
            controller.setSystemBarsBehavior(
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        }
    }
}
