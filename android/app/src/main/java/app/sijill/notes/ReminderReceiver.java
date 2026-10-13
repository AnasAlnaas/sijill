package app.sijill.notes;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;

/** An alarm went off, or Snooze / Done was tapped in a notification. Works with the app closed. */
public class ReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        Uri data = intent.getData();
        if (data == null || data.getLastPathSegment() == null) return;
        String id = data.getLastPathSegment();
        String action = intent.getAction();
        if (Reminders.ACTION_FIRE.equals(action)) Reminders.fire(ctx, id);
        else if (Reminders.ACTION_SNOOZE.equals(action)) Reminders.snooze(ctx, id);
        else if (Reminders.ACTION_DONE.equals(action)) Reminders.done(ctx, id);
    }
}
