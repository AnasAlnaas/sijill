package app.sijill.notes;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.os.PowerManager;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.util.Base64;
import android.view.WindowManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.activity.result.ActivityResult;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.core.content.pm.ShortcutInfoCompat;
import androidx.core.content.pm.ShortcutManagerCompat;
import androidx.core.graphics.drawable.IconCompat;
import androidx.documentfile.provider.DocumentFile;
import androidx.fragment.app.FragmentActivity;
import androidx.webkit.WebViewAssetLoader;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.FileInputStream;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Phone features the web app needs: lock, files and folders, printing, settings, shortcuts. */
@CapacitorPlugin(name = "SijillSystem")
public class SijillSystemPlugin extends Plugin {

    private static SijillSystemPlugin instance;
    private final Map<String, OutputStream> writers = new HashMap<>();
    private String readUri;
    private ParcelFileDescriptor readPfd;
    private FileChannel readChannel;
    private WebView printView;

    @Override
    public void load() {
        instance = this;
    }

    static void emitLaunch() {
        SijillSystemPlugin p = instance;
        if (p == null) return;
        JSObject a = LaunchActions.take();
        if (a != null) p.notifyListeners("launchAction", a);
    }

    // --- device ---------------------------------------------------------------------------------

    @PluginMethod
    public void getInfo(PluginCall call) {
        JSObject r = new JSObject();
        r.put("fontScale", getContext().getResources().getConfiguration().fontScale);
        r.put("sdk", Build.VERSION.SDK_INT);
        r.put("manufacturer", Build.MANUFACTURER);
        try {
            PackageInfo pi = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            r.put("appVersion", pi.versionName);
        } catch (Exception e) {
            r.put("appVersion", "");
        }
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        r.put("batteryUnrestricted", pm.isIgnoringBatteryOptimizations(getContext().getPackageName()));
        call.resolve(r);
    }

    @PluginMethod
    public void takeLaunchAction(PluginCall call) {
        JSObject a = LaunchActions.take();
        call.resolve(a != null ? a : new JSObject());
    }

    @PluginMethod
    public void setSecure(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            call.resolve();
        });
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        String which = call.getString("which", "app");
        Context ctx = getContext();
        String pkg = ctx.getPackageName();
        Intent i;
        switch (which) {
            case "battery":
                i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + pkg));
                break;
            case "notifications":
                i = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, pkg);
                break;
            case "exactAlarm":
                i = Build.VERSION.SDK_INT >= 31
                        ? new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + pkg))
                        : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg));
                break;
            default:
                i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg));
        }
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            ctx.startActivity(i);
        } catch (Exception e) {
            Intent fallback = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + pkg)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            ctx.startActivity(fallback);
        }
        call.resolve();
    }

    /** Home-screen shortcuts (long-press the icon), in the app's own language. */
    @PluginMethod
    public void setShortcuts(PluginCall call) {
        try {
            JSArray items = call.getArray("items", new JSArray());
            List<ShortcutInfoCompat> list = new ArrayList<>();
            for (int k = 0; k < items.length(); k++) {
                JSObject it = JSObject.fromJSONObject(items.getJSONObject(k));
                String action = it.getString("action");
                Intent intent = new Intent(getContext(), MainActivity.class)
                        .setAction(Intent.ACTION_VIEW)
                        .putExtra(LaunchActions.EXTRA_ACTION, action);
                int icon = "newChecklist".equals(action) ? R.drawable.ic_shortcut_checklist
                        : "voiceNote".equals(action) ? R.drawable.ic_shortcut_voice : R.drawable.ic_shortcut_note;
                list.add(new ShortcutInfoCompat.Builder(getContext(), action)
                        .setShortLabel(it.getString("label"))
                        .setIcon(IconCompat.createWithResource(getContext(), icon))
                        .setIntent(intent)
                        .setRank(k)
                        .build());
            }
            ShortcutManagerCompat.setDynamicShortcuts(getContext(), list);
            call.resolve();
        } catch (Exception e) {
            call.reject("shortcuts: " + e.getMessage(), e);
        }
    }

    // --- app lock ---------------------------------------------------------------------------------

    private static final int AUTHENTICATORS = BiometricManager.Authenticators.BIOMETRIC_WEAK
            | BiometricManager.Authenticators.DEVICE_CREDENTIAL;

    @PluginMethod
    public void canAuthenticate(PluginCall call) {
        int r = BiometricManager.from(getContext()).canAuthenticate(AUTHENTICATORS);
        KeyguardManager km = (KeyguardManager) getContext().getSystemService(Context.KEYGUARD_SERVICE);
        JSObject o = new JSObject();
        o.put("available", r == BiometricManager.BIOMETRIC_SUCCESS || (km != null && km.isDeviceSecure()));
        o.put("code", r);
        call.resolve(o);
    }

    @PluginMethod
    public void authenticate(PluginCall call) {
        Activity act = getActivity();
        act.runOnUiThread(() -> {
            BiometricPrompt prompt = new BiometricPrompt((FragmentActivity) act, ContextCompat.getMainExecutor(act),
                    new BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                            JSObject o = new JSObject();
                            o.put("ok", true);
                            call.resolve(o);
                        }

                        @Override
                        public void onAuthenticationError(int code, CharSequence msg) {
                            JSObject o = new JSObject();
                            o.put("ok", false);
                            o.put("code", code);
                            o.put("error", String.valueOf(msg));
                            call.resolve(o);
                        }
                    });
            BiometricPrompt.PromptInfo.Builder info = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle(call.getString("title", "سِجِلّ"))
                    .setAllowedAuthenticators(AUTHENTICATORS);
            String sub = call.getString("subtitle", "");
            if (sub != null && !sub.isEmpty()) info.setSubtitle(sub);
            prompt.authenticate(info.build());
        });
    }

    // --- printing: "Save as PDF" through Android's print engine ------------------------------------

    @PluginMethod
    public void printHtml(PluginCall call) {
        String html = call.getString("html", "");
        String name = call.getString("name", "Sijill");
        Activity act = getActivity();
        act.runOnUiThread(() -> {
            WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
                    .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(act))
                    .build();
            WebView wv = new WebView(act);
            wv.getSettings().setJavaScriptEnabled(false);
            wv.getSettings().setAllowFileAccess(false);
            wv.setWebViewClient(new WebViewClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    return loader.shouldInterceptRequest(request.getUrl());
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    // Give the bundled fonts a moment, then hand over to the system print dialog.
                    // (A hidden WebView never runs its own view.postDelayed, so use the main looper.)
                    new Handler(Looper.getMainLooper()).postDelayed(() -> {
                        PrintManager pm = (PrintManager) act.getSystemService(Context.PRINT_SERVICE);
                        PrintAttributes attrs = new PrintAttributes.Builder()
                                .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                                .build();
                        pm.print(name, view.createPrintDocumentAdapter(name), attrs);
                        JSObject o = new JSObject();
                        o.put("ok", true);
                        call.resolve(o);
                    }, 500);
                }
            });
            printView = wv; // keep a reference until printing is finished
            wv.loadDataWithBaseURL("https://appassets.androidplatform.net/", html, "text/html", "utf-8", null);
        });
    }

    // --- files: save as, open, read in chunks ----------------------------------------------------------

    @PluginMethod
    public void createDocument(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                .addCategory(Intent.CATEGORY_OPENABLE)
                .setType(call.getString("mime", "application/octet-stream"))
                .putExtra(Intent.EXTRA_TITLE, call.getString("name", "sijill"));
        startActivityForResult(call, i, "createDocumentResult");
    }

    @ActivityCallback
    private void createDocumentResult(PluginCall call, ActivityResult result) {
        JSObject o = new JSObject();
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null && result.getData().getData() != null) {
            o.put("uri", result.getData().getData().toString());
        }
        call.resolve(o);
    }

    @PluginMethod
    public void writeChunk(PluginCall call) {
        String uri = call.getString("uri");
        boolean append = Boolean.TRUE.equals(call.getBoolean("append", false));
        boolean last = Boolean.TRUE.equals(call.getBoolean("last", true));
        try {
            OutputStream out = writers.get(uri);
            if (out == null || !append) {
                if (out != null) out.close();
                out = getContext().getContentResolver().openOutputStream(Uri.parse(uri), "wt");
                writers.put(uri, out);
            }
            out.write(Base64.decode(call.getString("data", ""), Base64.DEFAULT));
            if (last) {
                out.flush();
                out.close();
                writers.remove(uri);
            }
            call.resolve();
        } catch (Exception e) {
            OutputStream out = writers.remove(uri);
            try {
                if (out != null) out.close();
            } catch (Exception ignored) {
            }
            call.reject("write: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void openDocument(PluginCall call) {
        JSArray mimes = call.getArray("mimes", new JSArray());
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
        try {
            List<String> list = mimes.toList();
            if (!list.isEmpty() && !list.contains("*/*")) i.putExtra(Intent.EXTRA_MIME_TYPES, list.toArray(new String[0]));
        } catch (Exception ignored) {
        }
        startActivityForResult(call, i, "openDocumentResult");
    }

    @ActivityCallback
    private void openDocumentResult(PluginCall call, ActivityResult result) {
        JSObject o = new JSObject();
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null && result.getData().getData() != null) {
            Uri uri = result.getData().getData();
            o.put("uri", uri.toString());
            ContentResolver cr = getContext().getContentResolver();
            o.put("mime", cr.getType(uri));
            try (Cursor c = cr.query(uri, null, null, null, null)) {
                if (c != null && c.moveToFirst()) {
                    int n = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    int s = c.getColumnIndex(OpenableColumns.SIZE);
                    if (n >= 0) o.put("name", c.getString(n));
                    if (s >= 0 && !c.isNull(s)) o.put("size", c.getLong(s));
                }
            } catch (Exception ignored) {
            }
            if (!o.has("size")) {
                try (ParcelFileDescriptor pfd = cr.openFileDescriptor(uri, "r")) {
                    o.put("size", pfd.getStatSize());
                } catch (Exception ignored) {
                }
            }
        }
        call.resolve(o);
    }

    @PluginMethod
    public void readChunk(PluginCall call) {
        String uri = call.getString("uri");
        // optLong copes with JS numbers arriving as Integer or Double (getLong does not).
        long offset = call.getData().optLong("offset", 0L);
        int length = call.getData().optInt("length", 0);
        try {
            if (readChannel == null || !uri.equals(readUri)) {
                closeReader();
                readPfd = getContext().getContentResolver().openFileDescriptor(Uri.parse(uri), "r");
                readChannel = new FileInputStream(readPfd.getFileDescriptor()).getChannel();
                readUri = uri;
            }
            // Positional reads: some providers' file handles ignore position() after a read.
            ByteBuffer buf = ByteBuffer.allocate(length);
            long pos = offset;
            while (buf.hasRemaining()) {
                int n = readChannel.read(buf, pos);
                if (n < 0) break;
                pos += n;
            }
            JSObject o = new JSObject();
            o.put("data", Base64.encodeToString(buf.array(), 0, buf.position(), Base64.NO_WRAP));
            call.resolve(o);
        } catch (Exception e) {
            closeReader();
            call.reject("read: " + e.getMessage(), e);
        }
    }

    private void closeReader() {
        try {
            if (readChannel != null) readChannel.close();
            if (readPfd != null) readPfd.close();
        } catch (Exception ignored) {
        }
        readChannel = null;
        readPfd = null;
        readUri = null;
    }

    // --- a backup folder the app may keep writing to --------------------------------------------------

    @PluginMethod
    public void pickFolder(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION
                        | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, i, "pickFolderResult");
    }

    @ActivityCallback
    private void pickFolderResult(PluginCall call, ActivityResult result) {
        JSObject o = new JSObject();
        if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null && result.getData().getData() != null) {
            Uri tree = result.getData().getData();
            getContext().getContentResolver().takePersistableUriPermission(tree,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            DocumentFile dir = DocumentFile.fromTreeUri(getContext(), tree);
            o.put("uri", tree.toString());
            o.put("name", dir != null && dir.getName() != null ? dir.getName() : tree.getLastPathSegment());
        }
        call.resolve(o);
    }

    @PluginMethod
    public void createInFolder(PluginCall call) {
        try {
            DocumentFile dir = DocumentFile.fromTreeUri(getContext(), Uri.parse(call.getString("tree")));
            DocumentFile f = dir.createFile(call.getString("mime", "application/octet-stream"), call.getString("name"));
            if (f == null) throw new Exception("could not create file in folder");
            JSObject o = new JSObject();
            o.put("uri", f.getUri().toString());
            call.resolve(o);
        } catch (Exception e) {
            call.reject("folder: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void listFolder(PluginCall call) {
        try {
            DocumentFile dir = DocumentFile.fromTreeUri(getContext(), Uri.parse(call.getString("tree")));
            JSArray files = new JSArray();
            for (DocumentFile f : dir.listFiles()) {
                if (!f.isFile()) continue;
                JSObject o = new JSObject();
                o.put("name", f.getName());
                o.put("uri", f.getUri().toString());
                o.put("size", f.length());
                o.put("modified", f.lastModified());
                files.put(o);
            }
            JSObject r = new JSObject();
            r.put("files", files);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("folder: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void deleteDocument(PluginCall call) {
        try {
            DocumentFile f = DocumentFile.fromSingleUri(getContext(), Uri.parse(call.getString("uri")));
            if (f != null) f.delete();
            call.resolve();
        } catch (Exception e) {
            call.reject("delete: " + e.getMessage(), e);
        }
    }
}
