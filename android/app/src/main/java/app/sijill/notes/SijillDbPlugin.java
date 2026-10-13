package app.sijill.notes;

import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The notes database: plain SQLite on the phone.
 * Durable by design: write-ahead log + full sync, so a note that was saved stays saved
 * even if the app is killed or the battery dies right after.
 * Every execute() call is one transaction: it all lands, or none of it does.
 */
@CapacitorPlugin(name = "SijillDb")
public class SijillDbPlugin extends Plugin {

    private static SQLiteDatabase db;

    static synchronized SQLiteDatabase get(Context ctx, String name) {
        if (db == null || !db.isOpen()) {
            db = SQLiteDatabase.openOrCreateDatabase(ctx.getDatabasePath(name), null);
            db.enableWriteAheadLogging();
            Cursor c = db.rawQuery("PRAGMA synchronous = FULL", null);
            c.close();
        }
        return db;
    }

    @PluginMethod
    public void open(PluginCall call) {
        try {
            getContext().getDatabasePath("x").getParentFile().mkdirs();
            get(getContext(), call.getString("name", "sijill.db"));
            call.resolve();
        } catch (Exception e) {
            call.reject("open failed: " + e.getMessage(), e);
        }
    }

    private static Object[] args(JSONArray values) throws Exception {
        if (values == null) return new Object[0];
        Object[] out = new Object[values.length()];
        for (int i = 0; i < values.length(); i++) {
            Object v = values.get(i);
            if (v == JSONObject.NULL) out[i] = null;
            else if (v instanceof Boolean) out[i] = ((Boolean) v) ? 1 : 0;
            else out[i] = v;
        }
        return out;
    }

    @PluginMethod
    public void execute(PluginCall call) {
        SQLiteDatabase d = get(getContext(), "sijill.db");
        JSArray statements = call.getArray("statements");
        try {
            d.beginTransaction();
            try {
                for (int i = 0; i < statements.length(); i++) {
                    JSONObject st = statements.getJSONObject(i);
                    String sql = st.getString("sql");
                    Object[] a = args(st.optJSONArray("values"));
                    if (a.length == 0) d.execSQL(sql);
                    else d.execSQL(sql, a);
                }
                d.setTransactionSuccessful();
            } finally {
                d.endTransaction();
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("write failed: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void query(PluginCall call) {
        SQLiteDatabase d = get(getContext(), "sijill.db");
        try {
            Object[] a = args(call.getArray("values"));
            String[] sargs = new String[a.length];
            for (int i = 0; i < a.length; i++) sargs[i] = a[i] == null ? null : String.valueOf(a[i]);
            JSArray rows = new JSArray();
            try (Cursor c = d.rawQuery(call.getString("sql"), sargs)) {
                String[] cols = c.getColumnNames();
                while (c.moveToNext()) {
                    JSObject row = new JSObject();
                    for (int i = 0; i < cols.length; i++) {
                        switch (c.getType(i)) {
                            case Cursor.FIELD_TYPE_INTEGER: row.put(cols[i], c.getLong(i)); break;
                            case Cursor.FIELD_TYPE_FLOAT: row.put(cols[i], c.getDouble(i)); break;
                            case Cursor.FIELD_TYPE_NULL: row.put(cols[i], JSONObject.NULL); break;
                            default: row.put(cols[i], c.getString(i));
                        }
                    }
                    rows.put(row);
                }
            }
            JSObject res = new JSObject();
            res.put("rows", rows);
            call.resolve(res);
        } catch (Exception e) {
            call.reject("read failed: " + e.getMessage(), e);
        }
    }
}
