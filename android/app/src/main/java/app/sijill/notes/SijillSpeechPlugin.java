package app.sijill.notes;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.ArrayList;

/**
 * Dictation with Google's speech recogniser (online for the best accuracy; the phone's offline
 * recogniser is used when there is no internet). Only text comes back; no audio is kept.
 * Listening continues across pauses (the recogniser is restarted after each phrase) until
 * the user stops, the app leaves the screen, or there has been silence for a while.
 */
@CapacitorPlugin(
        name = "SijillSpeech",
        permissions = { @Permission(strings = { Manifest.permission.RECORD_AUDIO }, alias = "microphone") }
)
public class SijillSpeechPlugin extends Plugin {

    private static final int MAX_SILENT_RUNS = 3; // roughly 15–20 seconds of silence

    private final Handler main = new Handler(Looper.getMainLooper());
    private SpeechRecognizer recognizer;
    private boolean active;
    private String lang = "ar-SA";
    private int silentRuns;
    private long lastLevelAt;
    private boolean ready;
    private boolean retriedStuck;
    private boolean preferOffline = false; // Google's online recogniser first: best accuracy and punctuation

    @PluginMethod
    public void available(PluginCall call) {
        main.post(() -> {
            JSObject r = new JSObject();
            r.put("available", SpeechRecognizer.isRecognitionAvailable(getContext()));
            r.put("onDevice", Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext()));
            r.put("permission", permissionName());
            call.resolve(r);
        });
    }

    private String permissionName() {
        PermissionState s = getPermissionState("microphone");
        return s == PermissionState.GRANTED ? "granted" : s == PermissionState.DENIED ? "denied" : "prompt";
    }

    @PluginMethod
    public void requestMic(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) {
            JSObject r = new JSObject();
            r.put("permission", "granted");
            call.resolve(r);
        } else {
            requestPermissionForAlias("microphone", call, "afterMic");
        }
    }

    @PermissionCallback
    private void afterMic(PluginCall call) {
        JSObject r = new JSObject();
        r.put("permission", permissionName());
        call.resolve(r);
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("permission", "permission");
            return;
        }
        lang = call.getString("lang", "ar-SA");
        silentRuns = 0;
        retriedStuck = false;
        preferOffline = false;
        active = true;
        main.post(this::listen);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        active = false;
        // stopListening lets the last phrase finish and come back as a final result.
        main.post(() -> {
            if (recognizer != null) recognizer.stopListening();
            else finish("stopped");
        });
        call.resolve();
    }

    @Override
    protected void handleOnPause() {
        // Never keep the microphone open when the app isn't on screen.
        if (active || recognizer != null) {
            active = false;
            main.post(() -> {
                if (recognizer != null) recognizer.cancel();
                finish("paused");
            });
        }
        super.handleOnPause();
    }

    private void listen() {
        if (!active) return;
        if (recognizer == null) {
            recognizer = SpeechRecognizer.createSpeechRecognizer(getContext());
            recognizer.setRecognitionListener(listener);
        }
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
                .putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang)
                .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                // Online by default (more accurate); offline only as the no-internet fallback.
                .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, preferOffline)
                .putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 2500L)
                .putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 2000L);
        if (Build.VERSION.SDK_INT >= 33 && preferOffline) {
            // Punctuation formatting: Google only accepts this for offline recognition
            // (sending it with an online request is rejected).
            i.putExtra(RecognizerIntent.EXTRA_ENABLE_FORMATTING, RecognizerIntent.FORMATTING_OPTIMIZE_QUALITY);
        }
        ready = false;
        try {
            recognizer.startListening(i);
            main.removeCallbacks(watchdog);
            main.postDelayed(watchdog, 7000);
        } catch (Exception e) {
            error("start", -1);
        }
    }

    // If the speech service never answers (it can crash or be restarting), reconnect once,
    // then report it rather than seeming to listen forever.
    private final Runnable watchdog = () -> {
        if (!active || ready) return;
        if (recognizer != null) {
            recognizer.destroy();
            recognizer = null;
        }
        if (retriedStuck) {
            error("recognizer", -2);
        } else {
            retriedStuck = true;
            listen();
        }
    };

    private void restart(long delay) {
        main.postDelayed(this::listen, delay);
    }

    private void finish(String reason) {
        main.removeCallbacks(watchdog);
        if (recognizer != null) {
            recognizer.destroy();
            recognizer = null;
        }
        JSObject o = new JSObject();
        o.put("reason", reason);
        notifyListeners("end", o);
    }

    private void error(String what, int code) {
        active = false;
        JSObject o = new JSObject();
        o.put("error", what);
        o.put("code", code);
        notifyListeners("error", o);
        finish("error");
    }

    private static String firstResult(Bundle b) {
        if (b == null) return "";
        ArrayList<String> list = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return list == null || list.isEmpty() || list.get(0) == null ? "" : list.get(0);
    }

    private final RecognitionListener listener = new RecognitionListener() {
        @Override
        public void onReadyForSpeech(Bundle params) {
            ready = true;
            main.removeCallbacks(watchdog);
            JSObject o = new JSObject();
            o.put("listening", true);
            notifyListeners("state", o);
        }

        @Override
        public void onBeginningOfSpeech() {}

        @Override
        public void onRmsChanged(float rmsdB) {
            long now = System.currentTimeMillis();
            if (now - lastLevelAt < 120) return;
            lastLevelAt = now;
            JSObject o = new JSObject();
            o.put("level", Math.max(0f, Math.min(1f, (rmsdB + 2f) / 12f)));
            notifyListeners("level", o);
        }

        @Override
        public void onBufferReceived(byte[] buffer) {}

        @Override
        public void onEndOfSpeech() {}

        @Override
        public void onError(int code) {
            boolean silence = code == SpeechRecognizer.ERROR_NO_MATCH || code == SpeechRecognizer.ERROR_SPEECH_TIMEOUT;
            if (!active) {
                finish("stopped");
                return;
            }
            if (silence) {
                if (++silentRuns >= MAX_SILENT_RUNS) {
                    active = false;
                    finish("silence");
                } else {
                    restart(150);
                }
                return;
            }
            boolean network = code == SpeechRecognizer.ERROR_NETWORK || code == SpeechRecognizer.ERROR_NETWORK_TIMEOUT || code == SpeechRecognizer.ERROR_SERVER;
            if (network && !preferOffline) {
                // No internet: try the phone's offline recogniser (works if the language pack is installed),
                // and let the app say so.
                preferOffline = true;
                JSObject n = new JSObject();
                n.put("kind", "offline");
                notifyListeners("notice", n);
                if (recognizer != null) {
                    recognizer.destroy();
                    recognizer = null;
                }
                restart(200);
                return;
            }
            if (preferOffline && (code == SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED || code == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE)) {
                // Offline was the fallback for having no internet, and there's no offline pack either.
                error("network", code);
                return;
            }
            if (code == SpeechRecognizer.ERROR_RECOGNIZER_BUSY || code == SpeechRecognizer.ERROR_CLIENT) {
                if (recognizer != null) {
                    recognizer.destroy();
                    recognizer = null;
                }
                restart(400);
                return;
            }
            String what = code == SpeechRecognizer.ERROR_NETWORK || code == SpeechRecognizer.ERROR_NETWORK_TIMEOUT || code == SpeechRecognizer.ERROR_SERVER
                    ? "network"
                    : code == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS ? "permission" : "recognizer";
            error(what, code);
        }

        @Override
        public void onResults(Bundle results) {
            String text = firstResult(results);
            if (!text.trim().isEmpty()) {
                silentRuns = 0;
                JSObject o = new JSObject();
                o.put("text", text);
                notifyListeners("final", o);
            }
            if (active) restart(60);
            else finish("stopped");
        }

        @Override
        public void onPartialResults(Bundle partial) {
            String text = firstResult(partial);
            JSObject o = new JSObject();
            o.put("text", text);
            notifyListeners("partial", o);
        }

        @Override
        public void onEvent(int eventType, Bundle params) {}
    };
}
