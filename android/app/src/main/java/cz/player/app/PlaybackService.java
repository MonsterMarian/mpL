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
import android.os.IBinder;
import androidx.core.app.NotificationCompat;

/**
 * Služba, která drží appku naživu, dokud hraje hudba.
 *
 * Zvuk hraje ve WebView, a ten je jen součástí procesu appky. Jakmile appka
 * zmizí z popředí, je její proces pro Android obyčejný kandidát na odstřel -
 * hudba pak uprostřed skladby ztichne a návrat do appky vypadá jako pád.
 * Služba v popředí tomu zabrání: dokud běží, systém proces nechá být.
 *
 * Sama nic nepřehrává. Ovládání ze zámku obstarává MediaSession, kterou hlásí
 * WebView, tahle notifikace jen říká, že se hraje, a otevře appku.
 */
public class PlaybackService extends Service {

    static final String EXTRA_TITLE = "title";
    static final String EXTRA_ARTIST = "artist";

    private static final String CHANNEL_ID = "playback";
    private static final int NOTIFICATION_ID = 1;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String title = intent != null ? intent.getStringExtra(EXTRA_TITLE) : null;
        String artist = intent != null ? intent.getStringExtra(EXTRA_ARTIST) : null;

        try {
            Notification notification = buildNotification(title, artist);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Exception error) {
            // Android 12+ neumožní rozjet službu v popředí odkudkoliv. Když to
            // neprojde, musí služba hned skončit - jinak ji systém sestřelí sám
            // s hláškou, že se do popředí nedostala včas.
            stopSelf();
            return START_NOT_STICKY;
        }

        // Bez hudby nemá služba co dělat: po sestřelení procesu se nekřísí.
        return START_NOT_STICKY;
    }

    private Notification buildNotification(String title, String artist) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Přehrávání",
                // Tichý kanál: hlásí se, že se hraje, ne že se něco stalo.
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setShowBadge(false);
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }

        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentIntent = PendingIntent.getActivity(
            this,
            0,
            open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title != null && !title.isEmpty() ? title : "P/_ayer")
            .setContentText(artist != null && !artist.isEmpty() ? artist : "Přehrává se")
            .setContentIntent(contentIntent)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build();
    }

    /** Zapne nebo osvěží službu. Volá se, když se rozjede skladba. */
    static void start(Context context, String title, String artist) {
        Intent intent = new Intent(context, PlaybackService.class);
        intent.putExtra(EXTRA_TITLE, title);
        intent.putExtra(EXTRA_ARTIST, artist);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (Exception error) {
            // Nepovedená služba nesmí shodit přehrávání - hudba hraje dál,
            // jen ji systém může na pozadí ukončit dřív.
        }
    }

    static void stop(Context context) {
        try {
            context.stopService(new Intent(context, PlaybackService.class));
        } catch (Exception error) {
            // Služba už neběží - není co řešit.
        }
    }
}
