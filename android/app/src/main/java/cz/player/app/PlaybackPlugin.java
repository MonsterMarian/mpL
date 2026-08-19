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
 * Most k {@link PlaybackService}.
 *
 * Webová vrstva ví, co hraje - nativní vrstva to umí říct systému a poslat
 * zpátky, co uživatel zmáčkl v notifikaci nebo na zamykací obrazovce.
 */
@CapacitorPlugin(
    name = "Playback",
    permissions = { @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class PlaybackPlugin extends Plugin {

    @Override
    public void load() {
        PlaybackService.setCommandSink((action, positionMs, source) -> {
            JSObject event = new JSObject();
            event.put("action", action);
            event.put("source", source);
            if (positionMs >= 0) event.put("positionMs", positionMs);
            notifyListeners("command", event);
        });
    }

    @Override
    protected void handleOnDestroy() {
        PlaybackService.setCommandSink(null);
        PlaybackService.stop(getContext());
        super.handleOnDestroy();
    }

    /**
     * Co hraje: název, interpret, obal, délka, pozice a jestli to běží.
     *
     * Čísla se čtou přes `optDouble`, ne přes `call.getLong`. Ten vrací výchozí
     * hodnotu pro všechno, co není přesně `Long` - a JSON z JavaScriptu dá
     * `Integer`, takže délka i pozice do služby chodily jako nula a v liště
     * svítilo 00:00 s posuvníkem na začátku.
     */
    @PluginMethod
    public void update(PluginCall call) {
        PlaybackService.update(
            getContext(),
            call.getString("title", ""),
            call.getString("artist", ""),
            call.getString("album", ""),
            call.getString("artwork"),
            millis(call, "durationMs"),
            millis(call, "positionMs"),
            Boolean.TRUE.equals(call.getBoolean("playing", false))
        );
        call.resolve();
    }

    private long millis(PluginCall call, String name) {
        double value = call.getData().optDouble(name, 0);
        if (Double.isNaN(value) || Double.isInfinite(value) || value < 0) return 0;
        return (long) value;
    }

    @PluginMethod
    public void stop(PluginCall call) {
        PlaybackService.stop(getContext());
        call.resolve();
    }

    /**
     * Povolení notifikací (Android 13+). Bez něj hudba hraje dál a session na
     * zámku funguje, jen notifikace není vidět - proto se ptá až u prvního
     * přehrání a odmítnutí není chyba.
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
}
