package cz.player.app;

import android.Manifest;
import android.os.Build;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

/**
 * Ovladač {@link PlaybackService}.
 *
 * Zvuk hraje ve službě, ne ve stránce - webová vrstva odsud říká, co se má
 * hrát, a zpátky dostává stav, pozici a stisky z notifikace i ze zámku.
 */
@CapacitorPlugin(
    name = "Playback",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class PlaybackPlugin extends Plugin {

    @Override
    public void load() {
        PlaybackService.setListener(
            new PlaybackService.Listener() {
                @Override
                public void onState(boolean playing, long positionMs, long durationMs) {
                    new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> {
                        JSObject event = new JSObject();
                        event.put("playing", playing);
                        event.put("positionMs", positionMs);
                        event.put("durationMs", durationMs);
                        notifyListeners("state", event);
                    });
                }

                @Override
                public void onCompleted() {
                    new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> {
                        try {
                            if (getBridge() != null && getBridge().getWebView() != null) {
                                getBridge().getWebView().resumeTimers();
                            }
                        } catch (Exception ignore) {}
                        notifyListeners("completed", new JSObject());
                    });
                }

                @Override
                public void onError(String message) {
                    new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> {
                        JSObject event = new JSObject();
                        event.put("message", message);
                        notifyListeners("failed", event);
                    });
                }

                @Override
                public void onCommand(String action, long positionMs, String source) {
                    new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> {
                        try {
                            if (getBridge() != null && getBridge().getWebView() != null) {
                                getBridge().getWebView().resumeTimers();
                            }
                        } catch (Exception ignore) {}
                        JSObject event = new JSObject();
                        event.put("action", action);
                        event.put("source", source);
                        if (positionMs >= 0) event.put("positionMs", positionMs);
                        notifyListeners("command", event);
                    });
                }

                @Override
                public void onTrackChanged(String trackId) {
                    new android.os.Handler(android.os.Looper.getMainLooper()).post(() -> {
                        try {
                            if (getBridge() != null && getBridge().getWebView() != null) {
                                getBridge().getWebView().resumeTimers();
                            }
                        } catch (Exception ignore) {}
                        JSObject event = new JSObject();
                        event.put("trackId", trackId);
                        notifyListeners("trackChanged", event);
                    });
                }
            }
        );
    }

    /*
     * Služba se schválně **nezastavuje**, když zmizí okno appky. Přesně o to
     * jde: hudba má hrát dál i se zavřenou appkou. Vypne ji uživatel, nebo
     * `stop()` z webové vrstvy.
     */

    /** Načte skladbu a (podle `playWhenReady`) ji rovnou pustí. */
    @PluginMethod
    public void load(PluginCall call) {
        String uri = call.getString("uri");
        if (uri == null || uri.isEmpty()) {
            call.reject("Chybí adresa skladby.", "PLAYBACK_BAD_REQUEST");
            return;
        }
        PlaybackService.load(
            getContext(),
            call.getString("id", ""),
            uri,
            call.getString("title", ""),
            call.getString("artist", ""),
            call.getString("album", ""),
            call.getString("artwork"),
            millis(call, "positionMs"),
            !Boolean.FALSE.equals(call.getBoolean("playWhenReady", true))
        );
        call.resolve();
    }

    /** Nastaví nativní frontu pro přepínání na pozadí / lock screenu. */
    @PluginMethod
    public void setQueue(PluginCall call) {
        com.getcapacitor.JSArray itemsArray = call.getArray("items");
        String currentId = call.getString("currentId", "");
        String repeatMode = call.getString("repeatMode", "off");

        java.util.List<PlaybackService.QueueItem> list = new java.util.ArrayList<>();
        if (itemsArray != null) {
            for (int i = 0; i < itemsArray.length(); i++) {
                try {
                    org.json.JSONObject obj = itemsArray.getJSONObject(i);
                    list.add(new PlaybackService.QueueItem(
                        obj.optString("id"),
                        obj.optString("uri"),
                        obj.optString("title"),
                        obj.optString("artist"),
                        obj.optString("album"),
                        obj.optString("artwork"),
                        obj.optLong("durationMs", 0)
                    ));
                } catch (Exception ignore) {}
            }
        }
        PlaybackService.updateQueue(list, currentId, repeatMode);
        call.resolve();
    }

    @PluginMethod
    public void play(PluginCall call) {
        PlaybackService.command(getContext(), PlaybackService.ACTION_PLAY, 0);
        call.resolve();
    }

    @PluginMethod
    public void pause(PluginCall call) {
        PlaybackService.command(getContext(), PlaybackService.ACTION_PAUSE, 0);
        call.resolve();
    }

    @PluginMethod
    public void seek(PluginCall call) {
        PlaybackService.command(getContext(), PlaybackService.ACTION_SEEK, millis(call, "positionMs"));
        call.resolve();
    }

    /** Co služba zrovna hraje - appka se podle toho po otevření srovná. */
    @PluginMethod
    public void current(PluginCall call) {
        String[] state = PlaybackService.snapshot();
        JSObject result = new JSObject();
        result.put("running", state != null);
        if (state != null) {
            result.put("uri", state[0]);
            result.put("playing", "1".equals(state[1]));
            result.put("positionMs", Long.parseLong(state[2]));
            result.put("durationMs", Long.parseLong(state[3]));
            if (state.length > 4 && !state[4].isEmpty()) {
                result.put("trackId", state[4]);
            }
        }
        call.resolve(result);
    }

    /**
     * Sloučí statistiku poslechů ze stránky s tou ve službě a vrátí výsledek.
     * Bez `stats` jen vrátí, co služba napočítala.
     */
    @PluginMethod
    public void mergePlayStats(PluginCall call) {
        PlayStats.merge(getContext(), call.getObject("stats"));
        JSObject result = new JSObject();
        result.put("stats", PlayStats.all(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        PlaybackService.stop(getContext());
        call.resolve();
    }

    /**
     * Povolení notifikací (Android 13+). Bez něj hudba hraje dál, jen ovládání
     * v liště není vidět - proto se ptá až u prvního přehrání a odmítnutí
     * není chyba.
     */
    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            || getPermissionState("notifications") == PermissionState.GRANTED) {
            call.resolve();
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationsCallback");
    }

    @PermissionCallback
    private void notificationsCallback(PluginCall call) {
        call.resolve();
    }

    /**
     * Čísla se čtou přes `optDouble`, ne přes `call.getLong`. Ten vrací výchozí
     * hodnotu pro všechno, co není přesně `Long` - a JSON z JavaScriptu dá
     * `Integer`, takže by pozice chodila jako nula.
     */
    private long millis(PluginCall call, String name) {
        double value = call.getData().optDouble(name, 0);
        if (Double.isNaN(value) || Double.isInfinite(value) || value < 0) return 0;
        return (long) value;
    }
}
