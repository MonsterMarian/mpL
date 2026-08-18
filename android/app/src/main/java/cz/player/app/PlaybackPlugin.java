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
        PlaybackService.setCommandSink((action, positionMs) -> {
            JSObject event = new JSObject();
            event.put("action", action);
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

    /** Co hraje: název, interpret, obal, délka, pozice a jestli to běží. */
    @PluginMethod
    public void update(PluginCall call) {
        PlaybackService.update(
            getContext(),
            call.getString("title", ""),
            call.getString("artist", ""),
            call.getString("album", ""),
            call.getString("artwork"),
            call.getLong("durationMs", 0L),
            call.getLong("positionMs", 0L),
            Boolean.TRUE.equals(call.getBoolean("playing", false))
        );
        call.resolve();
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
