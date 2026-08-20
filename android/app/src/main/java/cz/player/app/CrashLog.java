package cz.player.app;

import android.content.Context;
import android.content.SharedPreferences;
import java.io.PrintWriter;
import java.io.StringWriter;

/**
 * Poslední pád nativní části.
 *
 * Když spadne obrazovka v Javě, appka zmizí a v telefonu po ní nezůstane nic,
 * co by šlo přečíst - logcat je bez kabelu k ničemu. Výjimka se proto uloží
 * a Nastavení ji umí ukázat, stejně jako už umí chyby z webové vrstvy.
 *
 * Ukládá se do SharedPreferences: soubor by šlo poškodit tím samým pádem,
 * kvůli kterému se zapisuje.
 */
final class CrashLog {

    private static final String PREFS = "cz.player.app.crash";
    private static final String KEY = "last";

    private CrashLog() {}

    /** Nastaví se jednou při startu appky a chytá, co se nikde jinde nechytlo. */
    static void install(Context context) {
        Context app = context.getApplicationContext();
        Thread.UncaughtExceptionHandler previous = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, error) -> {
            record(app, error);
            // Pád se nepolyká: systém ho musí dořešit po svém, jinak zůstane
            // appka viset v nedefinovaném stavu.
            if (previous != null) previous.uncaughtException(thread, error);
        });
    }

    static void record(Context context, Throwable error) {
        StringWriter out = new StringWriter();
        error.printStackTrace(new PrintWriter(out));
        String trace = out.toString();
        // Do Nastavení se vejde pár řádků, ne celý výpis.
        note(context, trace.length() > 1200 ? trace.substring(0, 1200) : trace);
    }

    static void note(Context context, String message) {
        try {
            SharedPreferences prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            prefs.edit().putString(KEY, System.currentTimeMillis() + "\n" + message).apply();
        } catch (Exception ignored) {
            // Zápis o pádu nesmí vyrobit další pád.
        }
    }

    static String read(Context context) {
        try {
            return context
                .getApplicationContext()
                .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString(KEY, null);
        } catch (Exception error) {
            return null;
        }
    }

    static void clear(Context context) {
        try {
            context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(KEY).apply();
        } catch (Exception ignored) {
            // není co mazat
        }
    }
}
