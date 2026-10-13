package app.sijill.notes;

import android.Manifest;
import android.os.Build;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONObject;

@CapacitorPlugin(
        name = "SijillReminders",
        permissions = { @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications") }
)
public class SijillRemindersPlugin extends Plugin {

    private static SijillRemindersPlugin instance;

    @Override
    public void load() {
        instance = this;
        Reminders.ensureChannel(getContext());
    }

    /** Tell the open app about a Done / Snooze tap right away. */
    static void emit(JSONObject ev) {
        SijillRemindersPlugin p = instance;
        if (p == null) return;
        try {
            p.notifyListeners("reminderEvent", JSObject.fromJSONObject(ev));
        } catch (Exception ignored) {
        }
    }

    private JSObject statusObject() {
        JSObject r = new JSObject();
        String state;
        if (Build.VERSION.SDK_INT >= 33) {
            PermissionState ps = getPermissionState("notifications");
            if (ps == PermissionState.GRANTED) state = NotificationManagerCompat.from(getContext()).areNotificationsEnabled() ? "granted" : "denied";
            else if (ps == PermissionState.DENIED) state = "denied";
            else state = "prompt";
        } else {
            state = NotificationManagerCompat.from(getContext()).areNotificationsEnabled() ? "granted" : "denied";
        }
        r.put("notifications", state);
        r.put("exact", Reminders.canExact(getContext()));
        return r;
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(statusObject());
    }

    @PluginMethod
    public void request(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            requestPermissionForAlias("notifications", call, "afterPermission");
        } else {
            call.resolve(statusObject());
        }
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        Reminders.ensureChannel(getContext());
        call.resolve(statusObject());
    }

    @PluginMethod
    public void sync(PluginCall call) {
        try {
            JSArray items = call.getArray("items", new JSArray());
            JSObject strings = call.getObject("strings", null);
            Reminders.sync(getContext(), items, strings);
            Reminders.ensureChannel(getContext());
            call.resolve();
        } catch (Exception e) {
            call.reject("could not schedule reminders: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void takeEvents(PluginCall call) {
        JSObject r = new JSObject();
        try {
            r.put("events", JSArray.from(new Object[0]));
            r.put("events", Reminders.takeEvents(getContext()));
        } catch (Exception ignored) {
        }
        call.resolve(r);
    }
}
