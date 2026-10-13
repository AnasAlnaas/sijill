package app.sijill.notes;

import android.content.Intent;

import com.getcapacitor.JSObject;

/** What opened the app: a home-screen shortcut, or a tapped reminder. Read once by the web app. */
final class LaunchActions {
    private LaunchActions() {}

    static final String EXTRA_ACTION = "sijill_action";
    static final String EXTRA_NOTE = "sijill_note";

    private static JSObject pending;

    static synchronized void capture(Intent intent) {
        if (intent == null) return;
        String action = intent.getStringExtra(EXTRA_ACTION);
        if (action == null) return;
        JSObject o = new JSObject();
        o.put("action", action);
        String note = intent.getStringExtra(EXTRA_NOTE);
        if (note != null) o.put("noteId", note);
        pending = o;
        // Don't replay this action if the activity is recreated (e.g. rotation).
        intent.removeExtra(EXTRA_ACTION);
    }

    static synchronized JSObject take() {
        JSObject p = pending;
        pending = null;
        return p;
    }
}
