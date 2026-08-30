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
import android.media.AudioAttributes;
import android.media.MediaMetadata;
import android.media.MediaPlayer;
import android.media.session.MediaSession;
import android.media.session.PlaybackState;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import java.io.InputStream;

/**
 * Přehrávač hudby.
 *
 * Zvuk hraje **tady**, ne ve WebView. Dokud hrál ve stránce, byl svázaný
 * s oknem appky: stačilo appku odsunout nebo zavřít a hudba ztichla, protože
 * WebView zmizel i s ní. Služba v popředí žije dál a přehrávání drží, i když
 * je appka zavřená - přesně jak to dělá každý hudební přehrávač.
 *
 * Webová vrstva je odsud ovladač a výkladní skříň: řekne, co se má hrát,
 * a dostává zpátky stav a pozici. Systém dostává MediaSession, takže ovládání
 * je v notifikaci i na zamykací obrazovce.
 */
public class PlaybackService extends Service {

    static final String ACTION_LOAD = "cz.player.app.LOAD";
    static final String ACTION_PLAY = "cz.player.app.PLAY";
    static final String ACTION_PAUSE = "cz.player.app.PAUSE";
    static final String ACTION_SEEK = "cz.player.app.SEEK";
    static final String ACTION_STOP = "cz.player.app.STOP";
    static final String ACTION_COMMAND = "cz.player.app.COMMAND";

    static final String EXTRA_URI = "uri";
    static final String EXTRA_TITLE = "title";
    static final String EXTRA_ARTIST = "artist";
    static final String EXTRA_ALBUM = "album";
    static final String EXTRA_ARTWORK = "artwork";
    static final String EXTRA_POSITION = "positionMs";
    static final String EXTRA_PLAY_WHEN_READY = "playWhenReady";
    static final String EXTRA_COMMAND = "command";

    private static final String CHANNEL_ID = "playback";
    private static final int NOTIFICATION_ID = 1;
    /** Jak často se webové vrstvě hlásí pozice. Vteřina stačí, posuvník je hrubý. */
    private static final long TICK_MS = 1000;

    /** Kam se hlásí stav a stisky. Nastavuje ho plugin. */
    private static Listener listener;

    interface Listener {
        void onState(boolean playing, long positionMs, long durationMs);

        void onCompleted();

        void onError(String message);

        void onCommand(String action, long positionMs, String source);
    }

    static void setListener(Listener next) {
        listener = next;
    }

    /** Běžící instance - kvůli dotazu „co zrovna hraješ". */
    private static PlaybackService instance;

    private MediaSession session;
    private MediaPlayer player;
    private final Handler ticker = new Handler(Looper.getMainLooper());

    /** Co je zrovna načtené - podle toho se appka po otevření srovná se službou. */
    private String currentUri = "";
    private String title = "";
    private String artist = "";
    private String album = "";
    private String artworkUri;
    private Bitmap artwork;
    private boolean prepared = false;
    private boolean playWhenReady = false;
    /** Kam skočit, jakmile bude přehrávač připravený. */
    private long pendingSeekMs = 0;

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            publish();
            if (isPlaying()) ticker.postDelayed(this, TICK_MS);
        }
    };

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        session = new MediaSession(this, "P/_ayer");
        session.setCallback(
            new MediaSession.Callback() {
                @Override
                public void onPlay() {
                    resume();
                    notifyCommand("play", -1);
                }

                @Override
                public void onPause() {
                    pause();
                    notifyCommand("pause", -1);
                }

                @Override
                public void onSkipToNext() {
                    notifyCommand("next", -1);
                }

                @Override
                public void onSkipToPrevious() {
                    notifyCommand("previous", -1);
                }

                @Override
                public void onStop() {
                    pause();
                    notifyCommand("pause", -1);
                }

                @Override
                public void onSeekTo(long pos) {
                    seek(pos);
                }
            }
        );
        // Aktivní se sezení stává až se skladbou (viz open). Aktivní sezení bez
        // skladby je pro systém přehrávač, který hraje - a ten se v liště ukáže,
        // i když není co přehrát.
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;

        // Bez načtené skladby nemá služba co ovládat.
        //
        // Sem se dřív dalo dostat i tak, že si appka jen sáhla na pauzu - třeba
        // při rozjezdu videa nebo po otevření. Služba tím teprve vznikla, nic
        // načteného neměla, a přesto se přihlásila do popředí: v liště pak visel
        // přehrávač s náhradním názvem, textem "Přehrává se", nulovým časem a bez
        // obalu. Nic nehrálo, jen to tak vypadalo. Když není co ovládat, služba
        // rovnou končí.
        if (!ACTION_LOAD.equals(action) && !hasTrack()) {
            stopSelf();
            return START_NOT_STICKY;
        }

        if (ACTION_COMMAND.equals(action)) {
            String command = intent.getStringExtra(EXTRA_COMMAND);
            if ("play".equals(command)) resume();
            else if ("pause".equals(command)) pause();
            notifyCommand(command, -1);
            foreground();
            return START_NOT_STICKY;
        }

        if (ACTION_LOAD.equals(action)) {
            title = orEmpty(intent.getStringExtra(EXTRA_TITLE));
            artist = orEmpty(intent.getStringExtra(EXTRA_ARTIST));
            album = orEmpty(intent.getStringExtra(EXTRA_ALBUM));
            loadArtwork(intent.getStringExtra(EXTRA_ARTWORK));
            currentUri = orEmpty(intent.getStringExtra(EXTRA_URI));
            open(currentUri, intent.getLongExtra(EXTRA_POSITION, 0), intent.getBooleanExtra(EXTRA_PLAY_WHEN_READY, true));
        } else if (ACTION_PLAY.equals(action)) {
            resume();
        } else if (ACTION_PAUSE.equals(action)) {
            pause();
        } else if (ACTION_SEEK.equals(action)) {
            seek(intent.getLongExtra(EXTRA_POSITION, 0));
        } else if (ACTION_STOP.equals(action)) {
            stopSelf();
            return START_NOT_STICKY;
        }

        foreground();
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        if (instance == this) instance = null;
        ticker.removeCallbacks(tick);
        release();
        try {
            stopForeground(Service.STOP_FOREGROUND_REMOVE);
        } catch (Exception error) {
            // Služba v popředí nebyla - není co odklízet.
        }
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

    // --- přehrávač --------------------------------------------------------

    private void open(String uri, long positionMs, boolean autoplay) {
        release();
        if (uri == null || uri.isEmpty()) return;

        // Teď už systém ví o čem: sezení se smí hlásit do lišty.
        if (session != null) session.setActive(true);

        prepared = false;
        playWhenReady = autoplay;
        pendingSeekMs = Math.max(0, positionMs);

        try {
            player = new MediaPlayer();
            player.setAudioAttributes(
                new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build()
            );
            player.setDataSource(this, Uri.parse(uri));
            player.setOnPreparedListener(mp -> {
                prepared = true;
                if (pendingSeekMs > 0) {
                    mp.seekTo((int) pendingSeekMs);
                    pendingSeekMs = 0;
                }
                if (playWhenReady) mp.start();
                publish();
                schedule();
            });
            player.setOnCompletionListener(mp -> {
                ticker.removeCallbacks(tick);
                publish();
                Listener target = listener;
                if (target != null) target.onCompleted();
            });
            player.setOnErrorListener((mp, what, extra) -> {
                prepared = false;
                Listener target = listener;
                if (target != null) target.onError("Přehrávač selhal (" + what + "/" + extra + ")");
                return true;
            });
            player.prepareAsync();
        } catch (Exception error) {
            release();
            Listener target = listener;
            if (target != null) target.onError("Skladbu se nepodařilo otevřít.");
        }
    }

    private void resume() {
        playWhenReady = true;
        try {
            if (player != null && prepared && !player.isPlaying()) player.start();
        } catch (Exception error) {
            // Přehrávač v nesprávném stavu - stav se srovná při dalším načtení.
        }
        publish();
        schedule();
        foreground();
    }

    private void pause() {
        playWhenReady = false;
        try {
            if (player != null && prepared && player.isPlaying()) player.pause();
        } catch (Exception error) {
            // viz výše
        }
        ticker.removeCallbacks(tick);
        publish();
        foreground();
    }

    private void seek(long positionMs) {
        try {
            if (player != null && prepared) player.seekTo((int) Math.max(0, positionMs));
            else pendingSeekMs = Math.max(0, positionMs);
        } catch (Exception error) {
            // viz výše
        }
        publish();
    }

    private void release() {
        try {
            if (player != null) {
                player.reset();
                player.release();
            }
        } catch (Exception error) {
            // Přehrávač už neexistuje.
        }
        player = null;
        prepared = false;
    }

    /** Má služba vůbec skladbu? Bez ní není co ovládat ani co hlásit. */
    private boolean hasTrack() {
        return currentUri != null && !currentUri.isEmpty();
    }

    private boolean isPlaying() {
        try {
            return player != null && prepared && player.isPlaying();
        } catch (Exception error) {
            return false;
        }
    }

    private long positionMs() {
        try {
            return player != null && prepared ? Math.max(0, player.getCurrentPosition()) : 0;
        } catch (Exception error) {
            return 0;
        }
    }

    private long durationMs() {
        try {
            long value = player != null && prepared ? player.getDuration() : 0;
            return value > 0 ? value : 0;
        } catch (Exception error) {
            return 0;
        }
    }

    private void schedule() {
        ticker.removeCallbacks(tick);
        if (isPlaying()) ticker.postDelayed(tick, TICK_MS);
    }

    /** Stav do systému i do webové vrstvy naráz - ať se nerozejdou. */
    private void publish() {
        boolean playing = isPlaying();
        long position = positionMs();
        long duration = durationMs();

        if (session != null) {
            session.setMetadata(
                new MediaMetadata.Builder()
                    .putString(MediaMetadata.METADATA_KEY_TITLE, title)
                    .putString(MediaMetadata.METADATA_KEY_ARTIST, artist)
                    .putString(MediaMetadata.METADATA_KEY_ALBUM, album)
                    .putLong(MediaMetadata.METADATA_KEY_DURATION, duration)
                    .putBitmap(MediaMetadata.METADATA_KEY_ALBUM_ART, artwork)
                    .build()
            );
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
                    .setState(playing ? PlaybackState.STATE_PLAYING : PlaybackState.STATE_PAUSED, position, playing ? 1f : 0f)
                    .build()
            );
        }

        Listener target = listener;
        if (target != null) target.onState(playing, position, duration);
    }

    private void notifyCommand(String action, long positionMs) {
        Listener target = listener;
        if (target != null && action != null) target.onCommand(action, positionMs, "session");
    }

    // --- notifikace -------------------------------------------------------

    private void foreground() {
        // Notifikace o přehrávání bez skladby by lhala. Druhá pojistka k té
        // v onStartCommand - do popředí vede víc cest.
        if (!hasTrack()) return;
        try {
            Notification notification = buildNotification();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            } else {
                startForeground(NOTIFICATION_ID, notification);
            }
        } catch (Exception error) {
            // Android 12+ nepustí službu do popředí odkudkoliv. Hudba hraje dál,
            // jen ji systém může na pozadí ukončit dřív.
        }
    }

    /**
     * Obal alba z MediaStore. Zmenšený - do notifikace se plnotučný nevejde.
     * Skladba bez obalu dostane značku appky, jinak kreslí systém svoji notu.
     */
    private void loadArtwork(String uri) {
        if (uri == null || uri.isEmpty()) {
            if (!"brand".equals(artworkUri)) {
                if (artwork != null) artwork.recycle();
                artwork = brandArtwork();
                artworkUri = artwork != null ? "brand" : null;
            }
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
            loaded = null;
        }

        if (artwork != null) artwork.recycle();
        if (loaded != null) {
            artwork = loaded;
            artworkUri = uri;
        } else {
            artwork = brandArtwork();
            artworkUri = artwork != null ? "brand" : null;
        }
    }

    /**
     * Značka appky jako obal. Schválně vlastní PNG, ne `R.mipmap.ic_launcher`:
     * od Androidu 8 je z ikony adaptivní XML a `decodeResource` na něm vrací
     * null - proto v liště zůstávala cizí systémová nota.
     */
    private Bitmap brandArtwork() {
        try {
            return BitmapFactory.decodeResource(getResources(), R.drawable.brand_art);
        } catch (Exception error) {
            return null;
        }
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

        boolean playing = isPlaying();
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

    private static String orEmpty(String value) {
        return value == null ? "" : value;
    }

    // --- co volá plugin ---------------------------------------------------

    static void load(Context context, String uri, String title, String artist, String album, String artwork, long positionMs, boolean playWhenReady) {
        Intent intent = new Intent(context, PlaybackService.class)
            .setAction(ACTION_LOAD)
            .putExtra(EXTRA_URI, uri)
            .putExtra(EXTRA_TITLE, title)
            .putExtra(EXTRA_ARTIST, artist)
            .putExtra(EXTRA_ALBUM, album)
            .putExtra(EXTRA_ARTWORK, artwork)
            .putExtra(EXTRA_POSITION, positionMs)
            .putExtra(EXTRA_PLAY_WHEN_READY, playWhenReady);
        start(context, intent);
    }

    static void command(Context context, String action, long positionMs) {
        // Neběžící službu příkaz neprobouzí. Pauza ani posun nemají co dělat
        // s tichem a start jen kvůli nim by vyrobil notifikaci o ničem.
        if (instance == null) return;
        Intent intent = new Intent(context, PlaybackService.class).setAction(action).putExtra(EXTRA_POSITION, positionMs);
        start(context, intent);
    }

    private static void start(Context context, Intent intent) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (Exception error) {
            // Nepovedený start služby nesmí shodit appku.
        }
    }

    /**
     * Co služba zrovna hraje. Appka se podle toho po otevření srovná - jinak by
     * si myslela, že nehraje nic, a hudbu běžící na pozadí by přerazila.
     */
    static String[] snapshot() {
        PlaybackService running = instance;
        if (running == null) return null;
        return new String[] {
            running.currentUri,
            running.isPlaying() ? "1" : "0",
            String.valueOf(running.positionMs()),
            String.valueOf(running.durationMs()),
        };
    }

    static void stop(Context context) {
        try {
            context.stopService(new Intent(context, PlaybackService.class));
        } catch (Exception error) {
            // Služba už neběží - není co řešit.
        }
    }
}
