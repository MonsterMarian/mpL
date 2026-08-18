package cz.player.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.drawable.Icon;
import android.media.MediaMetadata;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import java.io.InputStream;

/**
 * Přehrávač tak, jak ho vidí systém.
 *
 * Zvuk sám hraje ve WebView, ale Android o něm neví nic - v notifikacích ani na
 * zamykací obrazovce se proto neobjevilo vůbec nic. Tahle služba mu to řekne:
 * drží MediaSession s názvem, interpretem, obalem a pozicí ve skladbě, kreslí
 * notifikaci s tlačítky a stisky posílá zpátky do webové vrstvy.
 *
 * Zároveň drží appku naživu, dokud se hraje. Bez služby v popředí je proces
 * s appkou na pozadí obyčejný kandidát na odstřel a hudba uprostřed skladby
 * ztichne.
 *
 * O zvukové ohnisko si tady schválně **neříkáme**. WebView si ho pro svoje
 * přehrávání bere sám, a když o něj požádá ještě služba, systém ho prvnímu
 * držiteli sebere - tedy vlastnímu WebView, které na ztrátu ohniska přehrávání
 * zastaví. Navenek to vypadalo, že hudba po zapnutí sama do vteřiny ztichne.
 * Pauzu při hovoru řeší WebView sám, tohle se tu nemá co dublovat.
 */
public class PlaybackService extends Service {

    static final String ACTION_UPDATE = "cz.player.app.UPDATE";
    static final String ACTION_COMMAND = "cz.player.app.COMMAND";

    static final String EXTRA_TITLE = "title";
    static final String EXTRA_ARTIST = "artist";
    static final String EXTRA_ALBUM = "album";
    static final String EXTRA_ARTWORK = "artwork";
    static final String EXTRA_DURATION = "durationMs";
    static final String EXTRA_POSITION = "positionMs";
    static final String EXTRA_PLAYING = "playing";
    static final String EXTRA_COMMAND = "command";

    private static final String CHANNEL_ID = "playback";
    private static final int NOTIFICATION_ID = 1;

    /** Kam se hlásí stisky z notifikace a ze zámku. Nastavuje ho plugin. */
    private static CommandSink sink;

    interface CommandSink {
        void onCommand(String action, long positionMs);
    }

    static void setCommandSink(CommandSink next) {
        sink = next;
    }

    private MediaSession session;

    private String title = "";
    private String artist = "";
    private String album = "";
    private String artworkUri;
    private Bitmap artwork;
    private long durationMs = 0;
    private long positionMs = 0;
    private boolean playing = false;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        session = new MediaSession(this, "P/_ayer");
        session.setCallback(
            new MediaSession.Callback() {
                @Override
                public void onPlay() {
                    send("play", -1);
                }

                @Override
                public void onPause() {
                    send("pause", -1);
                }

                @Override
                public void onSkipToNext() {
                    send("next", -1);
                }

                @Override
                public void onSkipToPrevious() {
                    send("previous", -1);
                }

                @Override
                public void onStop() {
                    send("stop", -1);
                }

                @Override
                public void onSeekTo(long pos) {
                    send("seek", pos);
                }
            }
        );
        session.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_COMMAND.equals(intent.getAction())) {
            send(intent.getStringExtra(EXTRA_COMMAND), -1);
            return START_NOT_STICKY;
        }

        if (intent != null) {
            title = orEmpty(intent.getStringExtra(EXTRA_TITLE));
            artist = orEmpty(intent.getStringExtra(EXTRA_ARTIST));
            album = orEmpty(intent.getStringExtra(EXTRA_ALBUM));
            durationMs = intent.getLongExtra(EXTRA_DURATION, 0);
            positionMs = intent.getLongExtra(EXTRA_POSITION, 0);
            playing = intent.getBooleanExtra(EXTRA_PLAYING, false);
            loadArtwork(intent.getStringExtra(EXTRA_ARTWORK));
        }

        publishMetadata();
        publishState();

        try {
            Notification notification = buildNotification();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Exception error) {
            // Android 12+ nepustí službu do popředí odkudkoliv. Když to neprojde,
            // musí služba hned skončit - jinak ji systém sestřelí sám s hláškou,
            // že se do popředí nedostala včas.
            stopSelf();
            return START_NOT_STICKY;
        }

        // Po pauze zůstane notifikace viset, ale ze zámku se dá odsunout:
        // hudba stojí, takže proces už nemá co držet.
        if (!playing && Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(Service.STOP_FOREGROUND_DETACH);
        }

        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        if (session != null) {
            session.setActive(false);
            session.release();
            session = null;
        }
        if (artwork != null) {
            artwork.recycle();
            artwork = null;
        }
        super.onDestroy();
    }

    private void send(String action, long pos) {
        CommandSink target = sink;
        if (target != null && action != null) target.onCommand(action, pos);
    }

    private static String orEmpty(String value) {
        return value == null ? "" : value;
    }

    private void publishMetadata() {
        if (session == null) return;
        MediaMetadata.Builder metadata = new MediaMetadata.Builder()
            .putString(MediaMetadata.METADATA_KEY_TITLE, title)
            .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
            .putString(MediaMetadata.METADATA_KEY_ALBUM, album)
            .putLong(MediaMetadata.METADATA_KEY_DURATION, durationMs);
        if (artwork != null) {
            metadata.putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artwork);
        }
        session.setMetadata(metadata.build());
    }

    /**
     * Stav pro zámek a notifikaci. Pozice se posílá jen při změně - systém si ji
     * mezi aktualizacemi dopočítá sám podle rychlosti přehrávání.
     */
    private void publishState() {
        if (session == null) return;
        session.setPlaybackState(
            new PlaybackState.Builder()
                .setActions(
                    PlaybackState.ACTION_PLAY
                        | PlaybackState.ACTION_PAUSE
                        | PlaybackState.ACTION_PLAY_PAUSE
                        | PlaybackState.ACTION_SKIP_TO_NEXT
                        | PlaybackState.ACTION_SKIP_TO_PREVIOUS
                        | PlaybackState.ACTION_SEEK_TO
                        | PlaybackState.ACTION_STOP
                )
                .setState(
                    playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED,
                    positionMs,
                    playing ? 1f : 0f
                )
                .build()
        );
    }

    /** Obal alba z MediaStore. Zmenšený - do notifikace se plnotučný nevejde. */
    private void loadArtwork(String uri) {
        if (uri == null || uri.isEmpty()) {
            if (artwork != null) artwork.recycle();
            artwork = null;
            artworkUri = null;
            return;
        }
        if (uri.equals(artworkUri) && artwork != null) return;

        Bitmap loaded = null;
        try {
            ContentResolver resolver = getContentResolver();
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            try (InputStream probe = resolver.openInputStream(Uri.parse(uri))) {
                BitmapFactory.decodeStream(probe, null, bounds);
            }

            BitmapFactory.Options options = new BitmapFactory.Options();
            int larger = Math.max(bounds.outWidth, bounds.outHeight);
            options.inSampleSize = larger > 512 ? Math.round((float) larger / 512f) : 1;
            try (InputStream stream = resolver.openInputStream(Uri.parse(uri))) {
                loaded = BitmapFactory.decodeStream(stream, null, options);
            }
        } catch (Exception error) {
            // Obal je ozdoba. Když nejde načíst, hraje se dál bez něj.
            loaded = null;
        }

        if (artwork != null) artwork.recycle();
        artwork = loaded;
        artworkUri = loaded != null ? uri : null;
    }

    private Notification buildNotification() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Přehrávání",
                // Tichý kanál: hlásí se, co hraje, ne že se něco stalo.
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setShowBadge(false);
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }

        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent content = PendingIntent.getActivity(
            this,
            0,
            open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification.Builder builder = new Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title.isEmpty() ? "P/_ayer" : title)
            .setContentText(artist.isEmpty() ? "Přehrává se" : artist)
            .setContentIntent(content)
            .setOngoing(playing)
            .setShowWhen(false)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setStyle(
                new Notification.MediaStyle()
                    .setMediaSession(session.getSessionToken())
                    // Na zamčeném displeji je místo na tři - zpět, přehrát, dál.
                    .setShowActionsInCompactView(0, 1, 2)
            )
            .addAction(action("Předchozí", android.R.drawable.ic_media_previous, "previous"))
            .addAction(
                playing
                    ? action("Pozastavit", android.R.drawable.ic_media_pause, "pause")
                    : action("Přehrát", android.R.drawable.ic_media_play, "play")
            )
            .addAction(action("Další", android.R.drawable.ic_media_next, "next"));

        if (artwork != null) builder.setLargeIcon(artwork);
        return builder.build();
    }

    private Notification.Action action(String label, int icon, String command) {
        Intent intent = new Intent(this, PlaybackService.class)
            .setAction(ACTION_COMMAND)
            .putExtra(EXTRA_COMMAND, command);
        PendingIntent pending = PendingIntent.getService(
            this,
            command.hashCode(),
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        return new Notification.Action.Builder(Icon.createWithResource(this, icon), label, pending).build();
    }

    /** Zapne nebo osvěží službu podle toho, co se zrovna hraje. */
    static void update(
        Context context,
        String title,
        String artist,
        String album,
        String artwork,
        long durationMs,
        long positionMs,
        boolean playing
    ) {
        Intent intent = new Intent(context, PlaybackService.class)
            .setAction(ACTION_UPDATE)
            .putExtra(EXTRA_TITLE, title)
            .putExtra(EXTRA_ARTIST, artist)
            .putExtra(EXTRA_ALBUM, album)
            .putExtra(EXTRA_ARTWORK, artwork)
            .putExtra(EXTRA_DURATION, durationMs)
            .putExtra(EXTRA_POSITION, positionMs)
            .putExtra(EXTRA_PLAYING, playing);
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
