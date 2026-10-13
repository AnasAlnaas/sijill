package app.sijill.notes;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Android forgets alarms on restart: put them all back (and after updates or clock changes). */
public class BootReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent intent) {
        Reminders.rescheduleAll(ctx);
    }
}
