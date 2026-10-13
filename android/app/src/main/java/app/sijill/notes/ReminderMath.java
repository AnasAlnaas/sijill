package app.sijill.notes;

import java.util.Calendar;

/**
 * When does a repeating reminder fire next? Mirrors src/core/recurrence.js exactly:
 * every occurrence is computed from the original start, so "monthly on the 31st"
 * stays on the 31st whenever the month has one.
 */
final class ReminderMath {
    private ReminderMath() {}

    static long occurrence(long start, String repeat, int k) {
        Calendar c = Calendar.getInstance();
        c.setTimeInMillis(start);
        int day = c.get(Calendar.DAY_OF_MONTH);
        switch (repeat) {
            case "daily":
                c.add(Calendar.DAY_OF_MONTH, k);
                break;
            case "weekly":
                c.add(Calendar.DAY_OF_MONTH, 7 * k);
                break;
            case "monthly":
                c.set(Calendar.DAY_OF_MONTH, 1);
                c.add(Calendar.MONTH, k);
                c.set(Calendar.DAY_OF_MONTH, Math.min(day, c.getActualMaximum(Calendar.DAY_OF_MONTH)));
                break;
            case "yearly":
                c.set(Calendar.DAY_OF_MONTH, 1);
                c.add(Calendar.YEAR, k);
                c.set(Calendar.DAY_OF_MONTH, Math.min(day, c.getActualMaximum(Calendar.DAY_OF_MONTH)));
                break;
            default:
                break;
        }
        return c.getTimeInMillis();
    }

    /** The first occurrence strictly after now, or -1 for one-off reminders already past. */
    static long next(long start, String repeat, long now) {
        if (start > now) return start;
        if (repeat == null || repeat.equals("none")) return -1;
        Calendar s = Calendar.getInstance();
        s.setTimeInMillis(start);
        Calendar n = Calendar.getInstance();
        n.setTimeInMillis(now);
        int k;
        switch (repeat) {
            case "daily": k = (int) ((now - start) / 86400000L); break;
            case "weekly": k = (int) ((now - start) / (7 * 86400000L)); break;
            case "monthly": k = (n.get(Calendar.YEAR) - s.get(Calendar.YEAR)) * 12 + n.get(Calendar.MONTH) - s.get(Calendar.MONTH); break;
            case "yearly": k = n.get(Calendar.YEAR) - s.get(Calendar.YEAR); break;
            default: return -1;
        }
        k = Math.max(0, k);
        while (k > 0 && occurrence(start, repeat, k) > now) k--;
        while (occurrence(start, repeat, k + 1) <= now) k++;
        return occurrence(start, repeat, k + 1);
    }
}
