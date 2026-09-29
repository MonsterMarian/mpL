package cz.player.app;

import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.JSObject;
import java.util.Iterator;
import java.util.Map;
import org.json.JSONObject;

/**
 * Kolikrát a kdy naposledy která skladba hrála.
 *
 * Drží se tady, ne v localStorage stránky. WebView si zápisy do localStorage
 * odkládá a na disk je posílá se zpožděním - když MIUI appku po zavření
 * sestřelí, poslední poslechy se ztratí a počty vypadají jako vynulované.
 * SharedPreferences s `commit()` jsou na disku hned.
 *
 * Počítá služba, protože jen ona vidí každé přepnutí - i to ze zámku nebo
 * automatické přehrání další skladby, když je appka zavřená.
 *
 * Hodnota je `počet:čas` (čas v ms), klíčem id skladby.
 */
final class PlayStats {

    private static final String PREFS = "cz.player.app.plays";

    private PlayStats() {}

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    /** Skladba se začala hrát od začátku. */
    static synchronized void record(Context context, String trackId) {
        if (trackId == null || trackId.isEmpty()) return;
        SharedPreferences store = prefs(context);
        long[] current = parse(store.getString(trackId, null));
        store.edit().putString(trackId, (current[0] + 1) + ":" + System.currentTimeMillis()).commit();
    }

    /**
     * Přidá statistiku, kterou má stránka (starší záznamy z localStorage,
     * poslechy v prohlížeči). Bere se větší z obou hodnot, takže opakované
     * sloučení nic nezdvojí.
     */
    static synchronized void merge(Context context, JSONObject incoming) {
        if (incoming == null) return;
        SharedPreferences store = prefs(context);
        SharedPreferences.Editor editor = store.edit();
        boolean changed = false;
        Iterator<String> ids = incoming.keys();
        while (ids.hasNext()) {
            String id = ids.next();
            JSONObject stat = incoming.optJSONObject(id);
            if (id.isEmpty() || stat == null) continue;
            long[] current = parse(store.getString(id, null));
            long count = Math.max(current[0], Math.max(0, stat.optLong("count", 0)));
            long at = Math.max(current[1], Math.max(0, stat.optLong("at", 0)));
            if (count == current[0] && at == current[1]) continue;
            editor.putString(id, count + ":" + at);
            changed = true;
        }
        if (changed) editor.commit();
    }

    static synchronized JSObject all(Context context) {
        JSObject result = new JSObject();
        for (Map.Entry<String, ?> entry : prefs(context).getAll().entrySet()) {
            if (!(entry.getValue() instanceof String)) continue;
            long[] stat = parse((String) entry.getValue());
            if (stat[0] <= 0) continue;
            JSObject item = new JSObject();
            item.put("count", stat[0]);
            item.put("at", stat[1]);
            result.put(entry.getKey(), item);
        }
        return result;
    }

    private static long[] parse(String value) {
        if (value == null) return new long[] { 0, 0 };
        try {
            int colon = value.indexOf(':');
            if (colon < 0) return new long[] { Long.parseLong(value), 0 };
            return new long[] { Long.parseLong(value.substring(0, colon)), Long.parseLong(value.substring(colon + 1)) };
        } catch (NumberFormatException error) {
            return new long[] { 0, 0 };
        }
    }
}
