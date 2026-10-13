package app.sijill.notes;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Reminders that fire on time with the app closed: each one is an exact alarm held by
 * Android itself. Their details are kept here (not in the WebView) so alarms can be
 * shown, repeated, snoozed and restored after a restart without the app running.
 */
final class Reminders {
    private Reminders() {}

    static final String CHANNEL = "reminders";
    static final String ACTION_FIRE = "app.sijill.notes.REMINDER";
    static final String ACTION_DONE = "app.sijill.notes.REMINDER_DONE";
    static final String ACTION_SNOOZE = "app.sijill.notes.REMINDER_SNOOZE";
    private static final String PREFS = "sijill_reminders";

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    // --- stored items: { id, at, start, repeat, title, body } ---------------------------------

    static synchronized JSONObject items(Context ctx) {
        try {
            return new JSONObject(prefs(ctx).getString("items", "{}"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    static synchronized void saveItems(Context ctx, JSONObject items) {
        prefs(ctx).edit().putString("items", items.toString()).commit();
    }

    static JSONObject strings(Context ctx) {
        try {
            return new JSONObject(prefs(ctx).getString("strings", "{}"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    static synchronized void addEvent(Context ctx, JSONObject ev) {
        try {
            JSONArray list = new JSONArray(prefs(ctx).getString("events", "[]"));
            list.put(ev);
            prefs(ctx).edit().putString("events", list.toString()).commit();
        } catch (Exception ignored) {
        }
    }

    static synchronized JSONArray takeEvents(Context ctx) {
        JSONArray list;
        try {
            list = new JSONArray(prefs(ctx).getString("events", "[]"));
        } catch (Exception e) {
            list = new JSONArray();
        }
        prefs(ctx).edit().putString("events", "[]").commit();
        return list;
    }

    // --- alarms ---------------------------------------------------------------------------------

    private static PendingIntent alarmIntent(Context ctx, String id, int flags) {
        Intent i = new Intent(ctx, ReminderReceiver.class)
                .setAction(ACTION_FIRE)
                .setData(Uri.parse("sijill://reminder/" + Uri.encode(id)));
        return PendingIntent.getBroadcast(ctx, id.hashCode(), i, flags | PendingIntent.FLAG_IMMUTABLE);
    }

    static boolean canExact(Context ctx) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms();
    }

    static void schedule(Context ctx, String id, long at) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = alarmIntent(ctx, id, PendingIntent.FLAG_UPDATE_CURRENT);
        if (canExact(ctx)) {
            am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        } else {
            // Exact alarms were turned off for the app: still remind, a few minutes either way.
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pi);
        }
    }

    static void cancel(Context ctx, String id) {
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        PendingIntent pi = alarmIntent(ctx, id, PendingIntent.FLAG_NO_CREATE);
        if (pi != null) {
            am.cancel(pi);
            pi.cancel();
        }
    }

    /** Replace everything scheduled with this list (from the app). */
    static synchronized void sync(Context ctx, JSONArray list, JSONObject strings) throws Exception {
        JSONObject old = items(ctx);
        JSONObject next = new JSONObject();
        for (int i = 0; i < list.length(); i++) {
            JSONObject it = list.getJSONObject(i);
            next.put(it.getString("id"), it);
        }
        JSONArray oldIds = old.names();
        if (oldIds != null) {
            for (int i = 0; i < oldIds.length(); i++) {
                String id = oldIds.getString(i);
                if (!next.has(id)) cancel(ctx, id);
            }
        }
        JSONArray ids = next.names();
        if (ids != null) {
            for (int i = 0; i < ids.length(); i++) {
                String id = ids.getString(i);
                schedule(ctx, id, next.getJSONObject(id).getLong("at"));
            }
        }
        saveItems(ctx, next);
        if (strings != null) prefs(ctx).edit().putString("strings", strings.toString()).commit();
    }

    /** Re-arm every stored alarm (after a restart, an update or a clock change). */
    static synchronized void rescheduleAll(Context ctx) {
        JSONObject all = items(ctx);
        JSONArray ids = all.names();
        if (ids == null) return;
        long now = System.currentTimeMillis();
        for (int i = 0; i < ids.length(); i++) {
            try {
                String id = ids.getString(i);
                JSONObject it = all.getJSONObject(id);
                if (it.optBoolean("fired")) continue;
                long at = it.getLong("at");
                if (at <= now) {
                    // Missed while the phone was off: show it now, then move on.
                    fire(ctx, id);
                } else {
                    schedule(ctx, id, at);
                }
            } catch (Exception ignored) {
            }
        }
    }

    // --- showing a reminder -------------------------------------------------------------------------

    static void ensureChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        String name = strings(ctx).optString("channel", "Reminders");
        NotificationChannel ch = new NotificationChannel(CHANNEL, name, NotificationManager.IMPORTANCE_HIGH);
        ch.enableVibration(true);
        nm.createNotificationChannel(ch);
    }

    static int notificationId(String id) {
        return id.hashCode();
    }

    /** Show the notification for this reminder and schedule its next occurrence. */
    static synchronized void fire(Context ctx, String id) {
        JSONObject all = items(ctx);
        JSONObject it = all.optJSONObject(id);
        if (it == null) return;
        show(ctx, id, it);
        try {
            String repeat = it.optString("repeat", "none");
            long next = ReminderMath.next(it.optLong("start", it.optLong("at")), repeat, System.currentTimeMillis());
            if (next > 0) {
                it.put("at", next);
                all.put(id, it);
                schedule(ctx, id, next);
            } else {
                // Keep it (unscheduled) so Snooze still knows its title.
                it.put("fired", true);
                all.put(id, it);
            }
            saveItems(ctx, all);
        } catch (Exception ignored) {
        }
    }

    private static void show(Context ctx, String id, JSONObject it) {
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            return;
        }
        ensureChannel(ctx);
        JSONObject s = strings(ctx);
        Intent open = new Intent(ctx, MainActivity.class)
                .setAction(Intent.ACTION_VIEW)
                .setData(Uri.parse("sijill://note/" + Uri.encode(id)))
                .putExtra(LaunchActions.EXTRA_ACTION, "openNote")
                .putExtra(LaunchActions.EXTRA_NOTE, id)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent contentPi = PendingIntent.getActivity(ctx, notificationId(id), open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        String title = it.optString("title", "سِجِلّ");
        String body = it.optString("body", "");
        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_sijill)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(contentPi)
                .addAction(0, s.optString("snooze", "Snooze"), actionIntent(ctx, ACTION_SNOOZE, id))
                .addAction(0, s.optString("done", "Done"), actionIntent(ctx, ACTION_DONE, id));
        NotificationManagerCompat.from(ctx).notify(notificationId(id), b.build());
    }

    private static PendingIntent actionIntent(Context ctx, String action, String id) {
        Intent i = new Intent(ctx, ReminderReceiver.class)
                .setAction(action)
                .setData(Uri.parse("sijill://reminder/" + Uri.encode(id)));
        return PendingIntent.getBroadcast(ctx, (action + id).hashCode(), i,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static synchronized void snooze(Context ctx, String id) {
        NotificationManagerCompat.from(ctx).cancel(notificationId(id));
        int minutes = strings(ctx).optInt("snoozeMinutes", 30);
        long until = System.currentTimeMillis() + minutes * 60000L;
        JSONObject all = items(ctx);
        try {
            JSONObject it = all.optJSONObject(id);
            if (it == null) it = new JSONObject().put("id", id).put("start", until).put("repeat", "none").put("title", "سِجِلّ");
            it.put("at", until);
            it.remove("fired");
            all.put(id, it);
            saveItems(ctx, all);
            schedule(ctx, id, until);
            JSONObject ev = new JSONObject().put("noteId", id).put("action", "snooze").put("at", System.currentTimeMillis()).put("until", until);
            addEvent(ctx, ev);
            SijillRemindersPlugin.emit(ev);
        } catch (Exception ignored) {
        }
    }

    static void done(Context ctx, String id) {
        NotificationManagerCompat.from(ctx).cancel(notificationId(id));
        try {
            JSONObject ev = new JSONObject().put("noteId", id).put("action", "done").put("at", System.currentTimeMillis());
            addEvent(ctx, ev);
            SijillRemindersPlugin.emit(ev);
        } catch (Exception ignored) {
        }
    }
}
