package app.sijill.notes;

import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Color;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SijillDbPlugin.class);
        registerPlugin(SijillSystemPlugin.class);
        registerPlugin(SijillRemindersPlugin.class);
        registerPlugin(SijillSpeechPlugin.class);
        super.onCreate(savedInstanceState);
        LaunchActions.capture(getIntent());
        // Text size is handled by the app itself (phone setting × the app's own slider),
        // so the WebView must not scale it a second time.
        getBridge().getWebView().getSettings().setTextZoom(100);
        // Show the theme's window colour (not white) while the page loads.
        getBridge().getWebView().setBackgroundColor(Color.TRANSPARENT);
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // Capacitor re-applies its own system-bar style (and window background) here; put ours back.
        getWindow().getDecorView().post(() -> SijillSystemPlugin.reapplyBars(this));
        getWindow().getDecorView().postDelayed(() -> SijillSystemPlugin.reapplyBars(this), 350);
    }

    @Override
    public void onResume() {
        super.onResume();
        getWindow().getDecorView().postDelayed(() -> SijillSystemPlugin.reapplyBars(this), 150);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        LaunchActions.capture(intent);
        SijillSystemPlugin.emitLaunch();
    }
}
