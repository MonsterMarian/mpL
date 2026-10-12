package cz.player.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import androidx.core.app.NotificationCompat;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * Stahování, které přežije odchod z appky.
 *
 * Samotné stahování běží ve vlákně pluginu ({@link MediaLibraryPlugin}). Bez
 * téhle služby ale proces po odchodu z appky nic nedrželo naživu: Android
 * (HyperOS obzvlášť rychle) ho po chvíli ukončil a stahování umřelo
 * v půlce - soubor se nikdy neuložil.
 *
 * Služba v popředí typu `dataSync` drží proces, dokud se něco stahuje, a její
 * oznámení je zároveň průběh: jedno oznámení pro všechna běžící stahování.
 * Hotové nebo selhané stahování dostane vlastní oznámení od pluginu.
 */
public class DownloadService extends Service {

    private static final String ACTION_REFRESH = "cz.player.app.DOWNLOAD_REFRESH";
    /** Pevné id oznámení služby - průběh všech stahování naráz. */
    static final int NOTIFICATION_ID = 2;
    static final String CHANNEL_ID = "downloads";

    /**
     * Nejkratší rozestup dvou aktualizací průběhu. Android častější
     * aktualizace oznámení zahazuje, a to i tu, na které záleží.
     */
    private static final long GAP_MS = 1000;

    private static final class Entry {
        final String name;
        int percent = -1;

        Entry(String name) {
            this.name = name;
        }
    }

    /** Běžící stahování podle id, v pořadí, jak začala. */
    private static final Map<String, Entry> active = new LinkedHashMap<>();
    private static DownloadService instance;

    private final Handler main = new Handler(Looper.getMainLooper());
    private long lastNotify = 0;
    private boolean refreshPending = false;

    // --- co volá plugin ---------------------------------------------------

    /**
     * Začátek stahování. Volá se ve chvíli, kdy je appka vepředu (uživatel
     * právě ťukl na Stáhnout) - jen tehdy smí služba do popředí.
     */
    static void begin(Context context, String id, String name) {
        synchronized (active) {
            active.put(id, new Entry(name));
        }
        Intent intent = new Intent(context, DownloadService.class).setAction(ACTION_REFRESH);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent);
            else context.startService(intent);
        } catch (Exception error) {
            // Bez služby se stahuje dál, jen odchod z appky ho může přerušit.
            CrashLog.note(context, "Služba stahování nenastartovala: " + error);
        }
    }

    static void progress(String id, int percent) {
        synchronized (active) {
            Entry entry = active.get(id);
            if (entry == null || entry.percent == percent) return;
            entry.percent = percent;
        }
        DownloadService running = instance;
        if (running != null) running.main.post(running::refreshSoon);
    }

    /** Konec (úspěch i chyba). Poslední stahování službu zastaví. */
    static void end(String id) {
        synchronized (active) {
            active.remove(id);
        }
        DownloadService running = instance;
        if (running != null) running.main.post(running::refreshNow);
    }

    // --- služba -----------------------------------------------------------

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Start přes startForegroundService musí vždy skončit startForeground,
        // jinak Android appku shodí - i když už mezitím není co stahovat.
        promote();
        refreshNow();
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        if (instance == this) instance = null;
        main.removeCallbacksAndMessages(null);
        super.onDestroy();
    }

    private void promote() {
        try {
            Notification notification = build();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Exception error) {
            CrashLog.note(this, "Stahování do popředí nepuštěno: " + error);
        }
    }

    /** Průběh s rozestupem - viz {@link #GAP_MS}. */
    private void refreshSoon() {
        if (refreshPending) return;
        long wait = GAP_MS - (System.currentTimeMillis() - lastNotify);
        if (wait <= 0) {
            refreshNow();
            return;
        }
        refreshPending = true;
        main.postDelayed(() -> {
            refreshPending = false;
            refreshNow();
        }, wait);
    }

    private void refreshNow() {
        boolean empty;
        synchronized (active) {
            empty = active.isEmpty();
        }
        if (empty) {
            try {
                stopForeground(STOP_FOREGROUND_REMOVE);
            } catch (Exception ignored) {
                // Nebyla v popředí.
            }
            stopSelf();
            return;
        }
        lastNotify = System.currentTimeMillis();
        try {
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null) manager.notify(NOTIFICATION_ID, build());
        } catch (Exception ignored) {
            // Bez povolení notifikací se stahuje dál, jen bez průběhu v liště.
        }
    }

    private Notification build() {
        ensureChannel(this);
        String title;
        int percent;
        int count;
        synchronized (active) {
            count = active.size();
            Entry first = active.isEmpty() ? null : active.values().iterator().next();
            title = count == 0 ? "Stahování" : count == 1 ? first.name : "Stahuji " + count + " " + (count < 5 ? "soubory" : "souborů");
            percent = first != null ? first.percent : -1;
        }

        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent content = PendingIntent.getActivity(this, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(MediaLibraryPlugin.NOTIFICATION_COLOR)
            .setContentTitle(title)
            .setContentText(percent >= 0 ? "Stahuji… " + percent + " %" : "Stahuji…")
            .setContentIntent(content)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            // Ať se oznámení ukáže hned, ne až po deseti vteřinách (Android 12+).
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setProgress(100, Math.max(0, percent), percent < 0);
        return builder.build();
    }

    static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Stahování", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Průběh stahování a převodu médií");
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager != null) manager.createNotificationChannel(channel);
    }
}
