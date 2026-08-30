package cz.player.app;

import android.app.Activity;
import android.app.PictureInPictureParams;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.res.ColorStateList;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.graphics.drawable.ShapeDrawable;
import android.graphics.drawable.shapes.OvalShape;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.provider.Settings;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.HorizontalScrollView;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.SeekBar;
import android.widget.Switch;
import android.widget.TextView;
import android.widget.Toast;
import androidx.annotation.OptIn;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.Tracks;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.function.Consumer;
import org.videolan.libvlc.LibVLC;
import org.videolan.libvlc.Media;
import org.videolan.libvlc.MediaPlayer;
import org.videolan.libvlc.interfaces.IMedia;
import org.videolan.libvlc.util.VLCVideoLayout;

/**
 * Přehrávač videa.
 *
 * Film se přehrává **tady**, do jiné aplikace se nikam neodkazuje. Aby to platilo
 * i pro soubory, na které systémové dekodéry nestačí, jsou v aplikaci přehrávače
 * dva:
 *
 * 1. ExoPlayer - rychlý, dekóduje tím, co má telefon v čipu. Zvládne většinu
 *    toho, co v telefonu je.
 * 2. libVLC - jádro VLC. Dekóduje si všechno vlastním kódem, takže mu nevadí
 *    AC3, DTS ani kontejnery, které Android nezná. Za to platí výkonem, proto
 *    naskočí až když první přehrávač ohlásí chybu (nebo si ho vybere uživatel).
 *
 * **Ovládání je vlastní a u obou přehrávačů stejné.** ExoPlayer si svoje
 * tlačítka nese, jenže jsou jeho: přidat se do nich nedá nic a u VLC nejsou
 * vůbec. Kdyby se použila, měl by uživatel dvojí ovládání a dvojí nastavení
 * podle toho, který dekodér zrovna vyhrál. Proto se ExoPlayeru ovládání vypne
 * ({@code setUseController(false)}) a všechno - tlačítka, posuvník i **jediné
 * ozubené kolo se vším nastavením** - kreslí tahle třída.
 *
 * **Obrazovka nezmizí sama.** Dřív se při nezdaru zavřela a v telefonu to
 * vypadalo, že klepnutí na film neudělalo vůbec nic. Teď každý konec kromě
 * dohraného filmu napíše, co se stalo, a čeká na uživatele.
 */
@OptIn(markerClass = UnstableApi.class)
public class VideoActivity extends Activity {

    static final String EXTRA_URI = "uri";
    static final String EXTRA_TITLE = "title";

    /** Kolik vteřin se čeká, než se mlčící ExoPlayer prohlásí za neúspěch. */
    private static final long EXO_TIMEOUT_MS = 9000;

    /** Po jak dlouhé nečinnosti zmizí lišty. Film má být vidět celý. */
    private static final long CHROME_TIMEOUT_MS = 4000;

    /** O kolik skáčou šipky. Deset vteřin je to, co mají ostatní přehrávače. */
    private static final long JUMP_MS = 10000;

    private static final String VIDEO_PREFS = "cz.player.app.video";
    private static final String BRIGHTNESS_KEY = "brightness";
    private static final String SPEED_KEY = "speed";
    private static final String PICTURE_KEY = "picture";
    private static final String REPEAT_KEY = "repeat";
    private static final String RESUME_KEY = "resume";
    private static final String ENGINE_KEY = "engine";
    private static final String ORIENTATION_KEY = "orientation";
    /** Za tímhle je otisk adresy filmu: kde se u něj naposledy skončilo. */
    private static final String POSITION_PREFIX = "position:";

    private static final int ENGINE_AUTO = 0;
    private static final int ENGINE_EXO = 1;
    private static final int ENGINE_VLC = 2;
    private static final String[] ENGINE_LABELS = { "Automaticky", "ExoPlayer", "VLC" };

    private static final float[] SPEEDS = { 0.25f, 0.5f, 0.75f, 1f, 1.25f, 1.5f, 1.75f, 2f, 3f };

    private static final String[] PICTURE_LABELS = { "Přizpůsobit", "Ořezat", "Roztáhnout" };
    private static final int[] PICTURE_EXO = {
        AspectRatioFrameLayout.RESIZE_MODE_FIT,
        AspectRatioFrameLayout.RESIZE_MODE_ZOOM,
        AspectRatioFrameLayout.RESIZE_MODE_FILL,
    };
    private static final MediaPlayer.ScaleType[] PICTURE_VLC = {
        MediaPlayer.ScaleType.SURFACE_BEST_FIT,
        MediaPlayer.ScaleType.SURFACE_FIT_SCREEN,
        MediaPlayer.ScaleType.SURFACE_FILL,
    };

    private static final String[] ORIENTATION_LABELS = { "Automaticky", "Na šířku", "Na výšku" };
    private static final int[] ORIENTATIONS = {
        ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED,
        ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE,
        ActivityInfo.SCREEN_ORIENTATION_PORTRAIT,
    };

    private static final int[] SLEEP_MINUTES = { 0, 15, 30, 45, 60, 90 };

    /** Barva značky. Stejná jako `colorAccent`, jen dosažitelná i z kódu. */
    private static final int ACCENT = 0xFFF5A33A;
    /** Stisk. Průsvitná bílá - oranžová by za tlačítkem blikla jako čtverec. */
    private static final int HIGHLIGHT = 0x33FFFFFF;
    private static final int PANEL = 0xF01A1A1A;

    private String source;
    private String title;

    /** Kořen obrazovky. Lišty i hlášení v něm přežijí výměnu přehrávače. */
    private FrameLayout root;
    /** Sem se sází přehrávač. Při přepnutí jádra se vyprázdní jen tohle. */
    private FrameLayout stage;

    private ExoPlayer player;
    private PlayerView view;

    private LibVLC vlc;
    private MediaPlayer vlcPlayer;
    private VLCVideoLayout vlcView;
    private ParcelFileDescriptor descriptor;

    private View topBar;
    private View controls;
    private ImageButton toggle;
    private SeekBar bar;
    private TextView clockNow;
    private TextView clockTotal;
    private boolean dragging;

    private LinearLayout statusBox;
    private ProgressBar spinner;
    private TextView statusText;
    private Button statusButton;

    private View settingsSheet;
    private LinearLayout settingsList;

    private View lockLayer;
    private boolean locked;

    /** Jas okna, `-1` = jak má systém. Drží se mezi filmy. */
    private float brightness = -1f;
    private float speed = 1f;
    /** Hlasitost 0-2. Nad jednu umí zesílit jen VLC, ExoPlayer se tam zastaví. */
    private float volume = 1f;
    private int picture;
    private boolean repeat;
    private boolean resumePlayback = true;
    private int engine = ENGINE_AUTO;
    private int orientation;
    private int sleepMinutes;
    /** Posun titulků a zvuku v milisekundách. Umí ho jen VLC. */
    private long spuDelayMs;
    private long audioDelayMs;

    /** Kam se má skočit, jakmile se film rozjede. Nula = od začátku. */
    private long pendingSeekMs;

    /** Ukázal se obraz? Bez toho je "konec filmu" ve skutečnosti chyba. */
    private boolean started;
    /** Vzdáno - ani druhý přehrávač to nedal. Pozdější hlášení to nepřepíšou. */
    private boolean surrendered;

    private final Handler ticker = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Intent intent = getIntent();
        source = intent != null ? intent.getStringExtra(EXTRA_URI) : null;
        title = intent != null ? intent.getStringExtra(EXTRA_TITLE) : null;

        // Obrazovka se staví dřív, než se sáhne na cokoli, co může selhat.
        // Kdyby se stavěla až po přehrávači, neúspěch by neměl kam napsat proč.
        try {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);

            root = new FrameLayout(this);
            root.setBackgroundColor(Color.BLACK);
            setContentView(root);

            // Až po setContentView, ne před ním: viz hideSystemBars().
            hideSystemBars();

            loadPreferences();

            stage = new FrameLayout(this);
            root.addView(stage, fill());

            addTapCatcher();
            addControls();
            addTopBar();
            addStatus();
            addSettingsSheet();
            addLockLayer();

            applyBrightness(brightness);
            applyOrientation();
            ticker.post(tick);
            showChrome();
        } catch (Throwable error) {
            // Bez obrazovky se nedá nic ukázat; jediné, co zbývá, je stopa.
            CrashLog.record(this, error);
            finish();
            return;
        }

        if (source == null || source.trim().isEmpty()) {
            surrender("Film přišel bez adresy souboru.");
            return;
        }

        if (resumePlayback) pendingSeekMs = loadPosition();

        working("Načítám film…");
        startEngine();
    }

    /** Spustí to jádro, které si uživatel vybral. Výchozí je ExoPlayer. */
    private void startEngine() {
        if (engine == ENGINE_VLC) {
            startVlc("volba uživatele");
            return;
        }
        try {
            startExo();
        } catch (Throwable error) {
            CrashLog.record(this, error);
            if (engine == ENGINE_AUTO) startVlc("ExoPlayer se nepodařilo spustit");
            else surrender("ExoPlayer se nepodařilo spustit.");
        }
    }

    // --- první jádro: systémové dekodéry -----------------------------------

    /** Systémové dekodéry přes ExoPlayer. */
    private void startExo() {
        view = new PlayerView(this);
        view.setKeepContentOnPlayerReset(true);
        view.setShowBuffering(PlayerView.SHOW_BUFFERING_ALWAYS);
        // Ovládání kreslí tahle třída, aby bylo u obou jader stejné.
        view.setUseController(false);
        view.setResizeMode(PICTURE_EXO[picture]);
        stage.addView(view, fill());

        // Když první dekodér souboru nesedne, zkusí se další v pořadí. Bez
        // tohohle stačí jeden zaseklý dekodér a video "nejde přehrát", přestože
        // ho telefon umí.
        DefaultRenderersFactory renderers = new DefaultRenderersFactory(this)
            .setEnableDecoderFallback(true)
            .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER);

        player = new ExoPlayer.Builder(this, renderers).build();
        // O zvuk se přehrávač přihlásí u systému. Bez toho hraje film přes
        // cokoli, co v telefonu zrovna běží.
        player.setAudioAttributes(
            new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(),
            true
        );
        player.addListener(
            new Player.Listener() {
                @Override
                public void onPlayerError(PlaybackException error) {
                    // Přepnout se smí až po návratu z tohohle volání: uvnitř
                    // vlastního posluchače se ExoPlayer uvolňovat nemá.
                    String reason = error.getErrorCodeName();
                    if (engine == ENGINE_AUTO) ticker.post(() -> startVlc("ExoPlayer: " + reason));
                    else ticker.post(() -> surrender("ExoPlayer: " + reason));
                }

                @Override
                public void onPlaybackStateChanged(int state) {
                    if (state == Player.STATE_READY) {
                        ticker.removeCallbacks(watchdog);
                        started = true;
                        applySeek();
                        playing();
                        refreshToggle();
                    }
                }

                @Override
                public void onIsPlayingChanged(boolean value) {
                    refreshToggle();
                }
            }
        );
        view.setPlayer(player);
        player.setMediaItem(MediaItem.fromUri(Uri.parse(source)));
        player.prepare();
        player.setPlayWhenReady(true);
        applySpeed();
        applyVolume();
        applyRepeat();
        // Vlastní volbu jádra hlídač nepřebíjí - uživatel si ExoPlayer přál.
        if (engine == ENGINE_AUTO) ticker.postDelayed(watchdog, EXO_TIMEOUT_MS);
    }

    /**
     * Ne každé selhání ExoPlayer ohlásí jako chybu - občas jen mlčky visí na
     * černé obrazovce. Když se do devíti vteřin nerozjede, bere se to jako
     * selhání a slova se ujme VLC.
     */
    private final Runnable watchdog = new Runnable() {
        @Override
        public void run() {
            if (player == null || player.getPlaybackState() == Player.STATE_READY) return;
            startVlc("ExoPlayer se nerozjel do " + (EXO_TIMEOUT_MS / 1000) + " s");
        }
    };

    // --- druhé jádro: libVLC ------------------------------------------------

    /**
     * libVLC.
     *
     * Dekóduje vlastním kódem, takže si poradí i s tím, co telefon v systému
     * nemá. Kreslí jen obraz - tlačítka k němu žádná nepatří, ta jsou vlastní.
     */
    private void startVlc(String why) {
        if (vlcPlayer != null || surrendered || isFinishing()) return;

        CrashLog.note(this, "Video -> VLC (" + why + ")");
        ticker.removeCallbacks(watchdog);
        releaseExo();
        started = false;
        working("Zkouším druhý přehrávač…");

        try {
            stage.removeAllViews();

            ArrayList<String> options = new ArrayList<>();
            // Zahazování snímků se u filmů projeví trháním obrazu; radši ne.
            options.add("--no-drop-late-frames");
            options.add("--no-skip-frames");
            options.add("--audio-time-stretch");
            vlc = new LibVLC(this, options);

            vlcView = new VLCVideoLayout(this);
            stage.addView(vlcView, fill());

            vlcPlayer = new MediaPlayer(vlc);
            vlcPlayer.attachViews(vlcView, null, false, false);
            vlcPlayer.setEventListener(event -> {
                if (event.type == MediaPlayer.Event.EncounteredError) {
                    ticker.post(() -> surrender("Přehrávač si se souborem neporadil."));
                } else if (event.type == MediaPlayer.Event.Playing) {
                    started = true;
                    ticker.post(() -> {
                        applySeek();
                        playing();
                        refreshToggle();
                    });
                } else if (event.type == MediaPlayer.Event.Paused) {
                    ticker.post(this::refreshToggle);
                } else if (event.type == MediaPlayer.Event.EndReached) {
                    // Konec dřív, než se cokoli ukázalo, není dohraný film, ale
                    // soubor, který se nepodařilo otevřít. Zavřít se kvůli tomu
                    // nesmí - vypadalo by to, že se nestalo vůbec nic.
                    if (!started) ticker.post(() -> surrender("Ze souboru se nepodařilo přečíst obraz."));
                    else if (repeat) ticker.post(this::replayVlc);
                    else ticker.post(this::finish);
                }
            });

            Media media = buildVlcMedia();
            if (media == null) {
                surrender("Soubor se nepodařilo otevřít - možná už v telefonu není.");
                return;
            }
            vlcPlayer.setMedia(media);
            media.release();
            vlcPlayer.play();
            applySpeed();
            applyVolume();
            applyPicture();
            applyDelays();
        } catch (Throwable error) {
            CrashLog.record(this, error);
            surrender("Přehrávač selhal: " + error.getClass().getSimpleName());
        }
    }

    /**
     * Zdroj pro VLC.
     *
     * Adresu content:// VLC sám neotevře - dostane rovnou otevřený soubor a ten
     * popisovač musí žít až do konce přehrávání. Při opakování se otevírá znovu:
     * dohraný popisovač stojí na konci souboru a druhé kolo by z něj nepřečetlo
     * nic.
     */
    private Media buildVlcMedia() throws Exception {
        Uri parsed = Uri.parse(source);
        Media media;
        if ("content".equals(parsed.getScheme())) {
            closeDescriptor();
            descriptor = getContentResolver().openFileDescriptor(parsed, "r");
            if (descriptor == null) return null;
            media = new Media(vlc, descriptor.getFileDescriptor());
        } else {
            media = new Media(vlc, parsed);
        }
        media.setHWDecoderEnabled(true, true);
        return media;
    }

    /** Druhé kolo u VLC. Po dohrání je přehrávač prázdný, film se vloží znovu. */
    private void replayVlc() {
        if (vlcPlayer == null || isFinishing()) return;
        try {
            Media media = buildVlcMedia();
            if (media == null) return;
            vlcPlayer.setMedia(media);
            media.release();
            vlcPlayer.play();
            applySpeed();
            applyVolume();
            applyPicture();
            applyDelays();
        } catch (Throwable error) {
            CrashLog.record(this, error);
        }
    }

    // --- ovládání společné pro obě jádra -----------------------------------

    /**
     * Průhledná vrstva přes celý obraz, která chytá klepnutí.
     *
     * Musí být samostatná: obraz kreslí buď PlayerView s vypnutým ovládáním,
     * nebo VLCVideoLayout, a ani jeden z nich klepnutí sám nehlásí.
     */
    private void addTapCatcher() {
        View catcher = new View(this);
        catcher.setClickable(true);
        catcher.setOnClickListener(v -> {
            if (chromeVisible()) hideChrome();
            else showChrome();
        });
        root.addView(catcher, fill());
    }

    /**
     * Spodní lišta: tlačítka uprostřed, pod nimi čas a posuvník.
     *
     * Tlačítka patří doprostřed, ne k jednomu okraji. U kraje je palec trefí
     * jen jednou rukou a druhá půlka lišty zeje prázdnotou; uprostřed jsou na
     * dosah zleva i zprava a přehrávač vypadá jako přehrávač.
     */
    private void addControls() {
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setBackgroundColor(Color.argb(150, 0, 0, 0));
        column.setPadding(dp(12), dp(6), dp(12), dp(14));

        LinearLayout buttons = new LinearLayout(this);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        buttons.setGravity(Gravity.CENTER);

        ImageButton back = iconButton(R.drawable.ic_player_back10, "Zpět o 10 vteřin");
        back.setOnClickListener(v -> jump(-JUMP_MS));
        LinearLayout.LayoutParams sideSize = new LinearLayout.LayoutParams(dp(48), dp(48));
        sideSize.setMargins(dp(18), 0, dp(18), 0);
        buttons.addView(back, sideSize);

        toggle = iconButton(R.drawable.ic_player_pause, "Pozastavit");
        buttons.addView(toggle, new LinearLayout.LayoutParams(dp(60), dp(60)));

        ImageButton forward = iconButton(R.drawable.ic_player_forward10, "Vpřed o 10 vteřin");
        forward.setOnClickListener(v -> jump(JUMP_MS));
        LinearLayout.LayoutParams otherSide = new LinearLayout.LayoutParams(dp(48), dp(48));
        otherSide.setMargins(dp(18), 0, dp(18), 0);
        buttons.addView(forward, otherSide);

        column.addView(buttons);

        toggle.setOnClickListener(v -> togglePlay());

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(0, dp(2), 0, 0);

        clockNow = new TextView(this);
        clockNow.setTextColor(Color.WHITE);
        clockNow.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        clockNow.setText("0:00");
        clockNow.setMinWidth(dp(46));
        row.addView(clockNow);

        bar = new SeekBar(this);
        bar.setMax(1000);
        bar.setOnSeekBarChangeListener(
            new SeekBar.OnSeekBarChangeListener() {
                @Override
                public void onProgressChanged(SeekBar seekBar, int progress, boolean fromUser) {
                    if (fromUser) keepChrome();
                }

                @Override
                public void onStartTrackingTouch(SeekBar seekBar) {
                    dragging = true;
                }

                @Override
                public void onStopTrackingTouch(SeekBar seekBar) {
                    dragging = false;
                    long total = duration();
                    if (total > 0) seekTo(total * seekBar.getProgress() / 1000);
                    keepChrome();
                }
            }
        );
        LinearLayout.LayoutParams barSize = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        barSize.setMargins(dp(6), 0, dp(6), 0);
        row.addView(bar, barSize);

        clockTotal = new TextView(this);
        clockTotal.setTextColor(Color.WHITE);
        clockTotal.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        clockTotal.setText("0:00");
        clockTotal.setMinWidth(dp(46));
        clockTotal.setGravity(Gravity.END);
        row.addView(clockTotal);

        column.addView(row);

        controls = column;
        root.addView(
            column,
            new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM)
        );
    }

    /** Horní lišta: zavřít, název filmu, zámek a ozubené kolo. */
    private void addTopBar() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setBackgroundColor(Color.argb(130, 0, 0, 0));
        row.setPadding(dp(6), dp(8), dp(10), dp(8));

        ImageButton close = iconButton(R.drawable.ic_player_close, "Zavřít video");
        close.setOnClickListener(v -> finish());
        row.addView(close, new LinearLayout.LayoutParams(dp(42), dp(42)));

        TextView name = new TextView(this);
        name.setText(title != null ? title : "");
        name.setTextColor(Color.WHITE);
        name.setMaxLines(1);
        name.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        name.setPadding(dp(8), 0, dp(8), 0);
        row.addView(name, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

        ImageButton lock = iconButton(R.drawable.ic_player_lock, "Zamknout ovládání");
        lock.setOnClickListener(v -> setLocked(true));
        row.addView(lock, new LinearLayout.LayoutParams(dp(42), dp(42)));

        ImageButton settings = iconButton(R.drawable.ic_player_settings, "Nastavení filmu");
        settings.setOnClickListener(v -> openSettings());
        row.addView(settings, new LinearLayout.LayoutParams(dp(42), dp(42)));

        topBar = row;
        root.addView(
            row,
            new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.TOP)
        );
    }

    private boolean chromeVisible() {
        return controls != null && controls.getVisibility() == View.VISIBLE;
    }

    /** Ukáže lišty a nastaví, kdy zase zmizí. */
    private void showChrome() {
        if (locked) return;
        if (controls != null) controls.setVisibility(View.VISIBLE);
        if (topBar != null) topBar.setVisibility(View.VISIBLE);
        keepChrome();
    }

    private void hideChrome() {
        ticker.removeCallbacks(chromeAway);
        if (controls != null) controls.setVisibility(View.GONE);
        if (topBar != null) topBar.setVisibility(View.GONE);
    }

    /** Odloží zmizení lišt - uživatel s nimi právě pracuje. */
    private void keepChrome() {
        ticker.removeCallbacks(chromeAway);
        ticker.postDelayed(chromeAway, CHROME_TIMEOUT_MS);
    }

    private final Runnable chromeAway = new Runnable() {
        @Override
        public void run() {
            // Zastavený film ani otevřené nastavení se neschovávají: uživatel
            // se na ovládání zrovna dívá.
            if (!isPlaying() || settingsOpen()) {
                keepChrome();
                return;
            }
            hideChrome();
        }
    };

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            long total = duration();
            long at = position();
            if (bar != null && !dragging) bar.setProgress(total > 0 ? (int) (at * 1000 / total) : 0);
            if (clockNow != null) clockNow.setText(clock(at));
            if (clockTotal != null) clockTotal.setText(clock(total));
            ticker.postDelayed(this, 500);
        }
    };

    private void refreshToggle() {
        if (toggle == null) return;
        boolean running = isPlaying();
        toggle.setImageResource(running ? R.drawable.ic_player_pause : R.drawable.ic_player_play);
        toggle.setContentDescription(running ? "Pozastavit" : "Přehrát");
    }

    private boolean isPlaying() {
        if (player != null) return player.isPlaying();
        if (vlcPlayer != null) return vlcPlayer.isPlaying();
        return false;
    }

    private void togglePlay() {
        if (player != null) {
            if (player.isPlaying()) player.pause();
            else player.play();
        } else if (vlcPlayer != null) {
            if (vlcPlayer.isPlaying()) vlcPlayer.pause();
            else vlcPlayer.play();
        }
        refreshToggle();
        keepChrome();
    }

    private void jump(long delta) {
        long total = duration();
        long target = Math.max(0, position() + delta);
        if (total > 1000) target = Math.min(total - 1000, target);
        seekTo(target);
        keepChrome();
    }

    private long position() {
        if (player != null) return Math.max(0, player.getCurrentPosition());
        if (vlcPlayer != null) return Math.max(0, vlcPlayer.getTime());
        return 0;
    }

    private long duration() {
        if (player != null) {
            long value = player.getDuration();
            return value == C.TIME_UNSET ? 0 : Math.max(0, value);
        }
        if (vlcPlayer != null) return Math.max(0, vlcPlayer.getLength());
        return 0;
    }

    private void seekTo(long ms) {
        if (player != null) player.seekTo(ms);
        else if (vlcPlayer != null) vlcPlayer.setTime(ms);
    }

    /** Skok tam, kde se posledně skončilo nebo odkud se přepnulo jádro. */
    private void applySeek() {
        if (pendingSeekMs <= 0) return;
        long target = pendingSeekMs;
        pendingSeekMs = 0;
        seekTo(target);
    }

    // --- zámek --------------------------------------------------------------

    /**
     * Zámek ovládání.
     *
     * Přes obraz se položí vrstva, která spolkne každý dotek, takže se film
     * nedá omylem pozastavit ani posunout loktem. Odemyká se jediným tlačítkem
     * v rohu - jinak by se z filmu nedalo ven.
     */
    private void addLockLayer() {
        FrameLayout layer = new FrameLayout(this);
        layer.setClickable(true);
        layer.setVisibility(View.GONE);

        ImageButton unlock = iconButton(R.drawable.ic_player_lock, "Odemknout ovládání");
        unlock.setBackground(pillBackground(Color.argb(140, 0, 0, 0), 24));
        unlock.setOnClickListener(v -> setLocked(false));
        FrameLayout.LayoutParams place = new FrameLayout.LayoutParams(dp(48), dp(48), Gravity.END | Gravity.CENTER_VERTICAL);
        place.setMargins(0, 0, dp(16), 0);
        layer.addView(unlock, place);

        lockLayer = layer;
        root.addView(layer, fill());
    }

    private void setLocked(boolean value) {
        locked = value;
        if (value) {
            closeSettings();
            hideChrome();
        }
        if (lockLayer != null) lockLayer.setVisibility(value ? View.VISIBLE : View.GONE);
        if (!value) showChrome();
        Toast.makeText(this, value ? "Ovládání zamčeno" : "Ovládání odemčeno", Toast.LENGTH_SHORT).show();
    }

    // --- nastavení: jediné ozubené kolo -------------------------------------

    /**
     * Nastavení filmu.
     *
     * Všechno je tady, za jedním ozubeným kolem - rychlost, obraz, jas,
     * hlasitost, stopy, titulky, opakování, otočení, časovač i volba jádra.
     * Dřív bylo nastavení na dvou místech: rychlost a stopy v nabídce
     * ExoPlayeru (a u VLC tedy nikde) a jas pod vlastní ikonou. Uživatel pak
     * hledal, co je kde, a půlka voleb u druhého přehrávače chyběla.
     *
     * Obsah se skládá při každém otevření: teprve tehdy je jisté, které jádro
     * hraje, jaké stopy film nese a na čem posuvníky zrovna stojí.
     */
    private void addSettingsSheet() {
        LinearLayout sheet = new LinearLayout(this);
        sheet.setOrientation(LinearLayout.VERTICAL);
        sheet.setBackgroundColor(PANEL);
        sheet.setVisibility(View.GONE);
        // Klepnutí do panelu nesmí propadnout na obraz pod ním.
        sheet.setClickable(true);

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(16), dp(10), dp(8), dp(4));

        TextView caption = new TextView(this);
        caption.setText("Nastavení");
        caption.setTextColor(Color.WHITE);
        caption.setTextSize(TypedValue.COMPLEX_UNIT_SP, 16);
        header.addView(caption, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

        ImageButton close = iconButton(R.drawable.ic_player_close, "Zavřít nastavení");
        close.setOnClickListener(v -> closeSettings());
        header.addView(close, new LinearLayout.LayoutParams(dp(40), dp(40)));
        sheet.addView(header);

        settingsList = new LinearLayout(this);
        settingsList.setOrientation(LinearLayout.VERTICAL);
        settingsList.setPadding(dp(16), 0, dp(16), dp(24));

        ScrollView scroll = new ScrollView(this);
        scroll.addView(
            settingsList,
            new ScrollView.LayoutParams(ScrollView.LayoutParams.MATCH_PARENT, ScrollView.LayoutParams.WRAP_CONTENT)
        );
        sheet.addView(scroll, new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, 0, 1f));

        settingsSheet = sheet;
        root.addView(
            sheet,
            new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.BOTTOM)
        );
    }

    private boolean settingsOpen() {
        return settingsSheet != null && settingsSheet.getVisibility() == View.VISIBLE;
    }

    private void openSettings() {
        if (settingsSheet == null || locked) return;
        // Necelá obrazovka schválně: jas i obraz se musí měnit před očima,
        // jinak uživatel nastavuje naslepo.
        FrameLayout.LayoutParams place = (FrameLayout.LayoutParams) settingsSheet.getLayoutParams();
        place.height = Math.max(dp(280), Math.round(root.getHeight() * 0.66f));
        settingsSheet.setLayoutParams(place);

        buildSettings();
        settingsSheet.setVisibility(View.VISIBLE);
        keepChrome();
    }

    private void closeSettings() {
        if (settingsSheet != null) settingsSheet.setVisibility(View.GONE);
        keepChrome();
    }

    private void buildSettings() {
        settingsList.removeAllViews();

        sectionSpeed();
        sectionPicture();
        sectionBrightness();
        sectionVolume();
        sectionTracks("Zvuková stopa", audioTracks(), "Film nese jen jednu zvukovou stopu.");
        sectionTracks("Titulky", subtitleTracks(), "V souboru žádné titulky nejsou.");
        if (vlcPlayer != null) sectionDelays();
        sectionToggles();
        sectionOrientation();
        sectionSleep();
        sectionExtras();
        sectionEngine();
        sectionInfo();
    }

    private void sectionSpeed() {
        heading("Rychlost přehrávání");
        LinearLayout row = chipRow();
        for (float value : SPEEDS) {
            boolean active = Math.abs(value - speed) < 0.001f;
            row.addView(
                chip(speedLabel(value), active, () -> {
                    speed = value;
                    applySpeed();
                    savePreferences();
                    buildSettings();
                })
            );
        }
    }

    private void sectionPicture() {
        heading("Obraz");
        LinearLayout row = chipRow();
        for (int i = 0; i < PICTURE_LABELS.length; i++) {
            int index = i;
            row.addView(
                chip(PICTURE_LABELS[i], picture == i, () -> {
                    picture = index;
                    applyPicture();
                    savePreferences();
                    buildSettings();
                })
            );
        }
    }

    private void sectionBrightness() {
        heading("Jas");
        TextView value = new TextView(this);
        SeekBar slider = new SeekBar(this);
        slider.setMax(100);
        slider.setProgress(Math.round(currentBrightness() * 100));
        value.setText(slider.getProgress() + " %");
        slider.setOnSeekBarChangeListener(
            new SeekBar.OnSeekBarChangeListener() {
                @Override
                public void onProgressChanged(SeekBar seekBar, int progress, boolean fromUser) {
                    if (!fromUser) return;
                    // Nula by displej zhasla úplně a panel by zmizel i s posuvníkem.
                    applyBrightness(Math.max(0.02f, progress / 100f));
                    value.setText(progress + " %");
                }

                @Override
                public void onStartTrackingTouch(SeekBar seekBar) {}

                @Override
                public void onStopTrackingTouch(SeekBar seekBar) {
                    savePreferences();
                }
            }
        );
        sliderRow(slider, value);
        settingsList.addView(
            action("Vrátit systémový jas", () -> {
                applyBrightness(-1f);
                savePreferences();
                buildSettings();
            })
        );
    }

    private void sectionVolume() {
        // Zesílit nad sto procent umí jen VLC. ExoPlayer hlasitost nad jedna
        // ignoruje, takže se u něj posuvník na stovce zastaví - jinak by
        // uživatel táhl za něco, co nic nedělá.
        int max = vlcPlayer != null ? 200 : 100;
        heading(max > 100 ? "Hlasitost (jde zesílit)" : "Hlasitost");
        TextView value = new TextView(this);
        SeekBar slider = new SeekBar(this);
        slider.setMax(max);
        slider.setProgress(Math.min(max, Math.round(volume * 100)));
        value.setText(slider.getProgress() + " %");
        slider.setOnSeekBarChangeListener(
            new SeekBar.OnSeekBarChangeListener() {
                @Override
                public void onProgressChanged(SeekBar seekBar, int progress, boolean fromUser) {
                    if (!fromUser) return;
                    volume = progress / 100f;
                    applyVolume();
                    value.setText(progress + " %");
                }

                @Override
                public void onStartTrackingTouch(SeekBar seekBar) {}

                @Override
                public void onStopTrackingTouch(SeekBar seekBar) {}
            }
        );
        sliderRow(slider, value);
    }

    private void sectionTracks(String label, List<TrackOption> options, String empty) {
        heading(label);
        if (options.isEmpty()) {
            settingsList.addView(note(empty));
            return;
        }
        for (TrackOption option : options) {
            settingsList.addView(
                action((option.selected ? "✓  " : "     ") + option.label, () -> {
                    option.select.run();
                    buildSettings();
                })
            );
        }
    }

    private void sectionDelays() {
        heading("Posun titulků");
        settingsList.addView(
            stepper(
                spuDelayMs + " ms",
                () -> {
                    spuDelayMs -= 50;
                    applyDelays();
                    buildSettings();
                },
                () -> {
                    spuDelayMs += 50;
                    applyDelays();
                    buildSettings();
                }
            )
        );

        heading("Posun zvuku");
        settingsList.addView(
            stepper(
                audioDelayMs + " ms",
                () -> {
                    audioDelayMs -= 50;
                    applyDelays();
                    buildSettings();
                },
                () -> {
                    audioDelayMs += 50;
                    applyDelays();
                    buildSettings();
                }
            )
        );
    }

    private void sectionToggles() {
        heading("Přehrávání");
        settingsList.addView(
            switchRow("Opakovat film", repeat, value -> {
                repeat = value;
                applyRepeat();
                savePreferences();
            })
        );
        settingsList.addView(
            switchRow("Pokračovat, kde jsem skončil", resumePlayback, value -> {
                resumePlayback = value;
                savePreferences();
            })
        );
    }

    private void sectionOrientation() {
        heading("Otočení obrazovky");
        LinearLayout row = chipRow();
        for (int i = 0; i < ORIENTATION_LABELS.length; i++) {
            int index = i;
            row.addView(
                chip(ORIENTATION_LABELS[i], orientation == i, () -> {
                    orientation = index;
                    applyOrientation();
                    savePreferences();
                    buildSettings();
                })
            );
        }
    }

    private void sectionSleep() {
        heading("Časovač vypnutí");
        LinearLayout row = chipRow();
        for (int value : SLEEP_MINUTES) {
            int minutes = value;
            row.addView(
                chip(minutes == 0 ? "Vypnuto" : minutes + " min", sleepMinutes == minutes, () -> {
                    setSleep(minutes);
                    buildSettings();
                })
            );
        }
    }

    private void sectionExtras() {
        heading("Další");
        settingsList.addView(
            action("Zamknout ovládání", () -> {
                closeSettings();
                setLocked(true);
            })
        );
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settingsList.addView(
                action("Obraz v obraze", () -> {
                    closeSettings();
                    enterPip();
                })
            );
        }
    }

    private void sectionEngine() {
        heading("Přehrávač");
        LinearLayout row = chipRow();
        for (int i = 0; i < ENGINE_LABELS.length; i++) {
            int index = i;
            row.addView(chip(ENGINE_LABELS[i], engine == i, () -> useEngine(index)));
        }
        settingsList.addView(
            note("Automaticky = ExoPlayer, a když si se souborem neporadí, naskočí VLC. VLC zvládne víc formátů, ale telefon dá víc práce.")
        );
    }

    private void sectionInfo() {
        heading("O souboru");
        settingsList.addView(note(fileInfo()));
    }

    // --- stavební prvky nastavení -------------------------------------------

    /** Jedna volitelná stopa. Obě jádra je nabízejí, jen jinak pojmenované. */
    private static final class TrackOption {

        final String label;
        final boolean selected;
        final Runnable select;

        TrackOption(String label, boolean selected, Runnable select) {
            this.label = label;
            this.selected = selected;
            this.select = select;
        }
    }

    private void heading(String text) {
        TextView caption = new TextView(this);
        caption.setText(text);
        caption.setTextColor(ACCENT);
        caption.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        caption.setAllCaps(true);
        caption.setPadding(0, dp(18), 0, dp(6));
        settingsList.addView(caption);
    }

    private TextView note(String text) {
        TextView caption = new TextView(this);
        caption.setText(text);
        caption.setTextColor(Color.argb(150, 255, 255, 255));
        caption.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        caption.setPadding(0, dp(4), 0, dp(4));
        return caption;
    }

    /** Řádka tlačítek, která se vejde i na úzký displej - dá se posouvat. */
    private LinearLayout chipRow() {
        HorizontalScrollView scroll = new HorizontalScrollView(this);
        scroll.setHorizontalScrollBarEnabled(false);
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        scroll.addView(row);
        settingsList.addView(scroll);
        return row;
    }

    private TextView chip(String label, boolean active, Runnable click) {
        TextView button = new TextView(this);
        button.setText(label);
        button.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        button.setTextColor(active ? Color.BLACK : Color.WHITE);
        button.setPadding(dp(14), dp(9), dp(14), dp(9));
        button.setBackground(pillBackground(active ? ACCENT : Color.argb(38, 255, 255, 255), 20));
        button.setOnClickListener(v -> click.run());
        LinearLayout.LayoutParams place = new LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.WRAP_CONTENT,
            LinearLayout.LayoutParams.WRAP_CONTENT
        );
        place.setMargins(0, dp(2), dp(8), dp(2));
        button.setLayoutParams(place);
        return button;
    }

    private TextView action(String label, Runnable click) {
        TextView button = new TextView(this);
        button.setText(label);
        button.setTextColor(Color.WHITE);
        button.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        button.setPadding(dp(6), dp(12), dp(6), dp(12));
        button.setBackground(pillBackground(Color.TRANSPARENT, 8));
        button.setOnClickListener(v -> click.run());
        return button;
    }

    private void sliderRow(SeekBar slider, TextView value) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);

        value.setTextColor(Color.WHITE);
        value.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        value.setMinWidth(dp(52));
        value.setGravity(Gravity.END);

        row.addView(slider, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));
        row.addView(value);
        settingsList.addView(row);
    }

    private LinearLayout switchRow(String label, boolean value, Consumer<Boolean> onChange) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(0, dp(6), 0, dp(6));

        TextView caption = new TextView(this);
        caption.setText(label);
        caption.setTextColor(Color.WHITE);
        caption.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        row.addView(caption, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

        Switch button = new Switch(this);
        button.setChecked(value);
        button.setOnCheckedChangeListener((view, checked) -> onChange.accept(checked));
        row.addView(button);
        return row;
    }

    private LinearLayout stepper(String value, Runnable minus, Runnable plus) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);

        row.addView(chip("− 50 ms", false, minus));

        TextView caption = new TextView(this);
        caption.setText(value);
        caption.setTextColor(Color.WHITE);
        caption.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
        caption.setGravity(Gravity.CENTER);
        row.addView(caption, new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f));

        row.addView(chip("+ 50 ms", false, plus));
        return row;
    }

    // --- co nastavení dělá ---------------------------------------------------

    private void applySpeed() {
        try {
            if (player != null) player.setPlaybackSpeed(speed);
            if (vlcPlayer != null) vlcPlayer.setRate(speed);
        } catch (Throwable error) {
            CrashLog.record(this, error);
        }
    }

    private void applyVolume() {
        try {
            if (player != null) player.setVolume(Math.min(1f, volume));
            if (vlcPlayer != null) vlcPlayer.setVolume(Math.round(volume * 100));
        } catch (Throwable error) {
            CrashLog.record(this, error);
        }
    }

    private void applyPicture() {
        try {
            if (view != null) view.setResizeMode(PICTURE_EXO[picture]);
            if (vlcPlayer != null) vlcPlayer.setVideoScale(PICTURE_VLC[picture]);
        } catch (Throwable error) {
            CrashLog.record(this, error);
        }
    }

    private void applyRepeat() {
        // VLC opakuje ručně: po dohrání je jeho přehrávač prázdný a film se do
        // něj musí vložit znovu (viz replayVlc).
        if (player != null) player.setRepeatMode(repeat ? Player.REPEAT_MODE_ONE : Player.REPEAT_MODE_OFF);
    }

    /** Posun stop. Umí ho jen VLC - ExoPlayer na to rozhraní nemá. */
    private void applyDelays() {
        if (vlcPlayer == null) return;
        try {
            vlcPlayer.setSpuDelay(spuDelayMs * 1000);
            vlcPlayer.setAudioDelay(audioDelayMs * 1000);
        } catch (Throwable error) {
            CrashLog.record(this, error);
        }
    }

    private void applyOrientation() {
        try {
            setRequestedOrientation(ORIENTATIONS[orientation]);
        } catch (Throwable error) {
            CrashLog.record(this, error);
        }
    }

    private void setSleep(int minutes) {
        sleepMinutes = minutes;
        ticker.removeCallbacks(sleeper);
        if (minutes > 0) ticker.postDelayed(sleeper, minutes * 60000L);
    }

    /**
     * Časovač jen pozastaví. Zavřít obrazovku by znamenalo ztratit místo ve
     * filmu i nastavení - a usínající divák to nemá jak vzít zpátky.
     */
    private final Runnable sleeper = new Runnable() {
        @Override
        public void run() {
            sleepMinutes = 0;
            if (player != null) player.pause();
            if (vlcPlayer != null && vlcPlayer.isPlaying()) vlcPlayer.pause();
            refreshToggle();
            showChrome();
            Toast.makeText(VideoActivity.this, "Časovač vypnutí: film se zastavil.", Toast.LENGTH_LONG).show();
        }
    };

    private void enterPip() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        try {
            enterPictureInPictureMode(new PictureInPictureParams.Builder().build());
        } catch (Throwable error) {
            CrashLog.record(this, error);
            Toast.makeText(this, "Obraz v obraze telefon nepustil.", Toast.LENGTH_SHORT).show();
        }
    }

    /**
     * Ruční volba jádra.
     *
     * Film se rozjede znovu, ale od stejného místa - přepnutí kvůli zvuku nebo
     * kvůli výkonu nemá stát za trest v podobě hledání, kde uživatel skončil.
     */
    private void useEngine(int choice) {
        if (choice == engine) return;
        engine = choice;
        savePreferences();

        long at = position();
        closeSettings();
        ticker.removeCallbacks(watchdog);
        surrendered = false;
        started = false;
        pendingSeekMs = at;

        releaseExo();
        releaseVlc();
        stage.removeAllViews();

        working("Přepínám přehrávač…");
        startEngine();
    }

    // --- stopy ---------------------------------------------------------------

    private List<TrackOption> audioTracks() {
        List<TrackOption> options = new ArrayList<>();
        if (player != null) {
            for (Tracks.Group group : player.getCurrentTracks().getGroups()) {
                if (group.getType() != C.TRACK_TYPE_AUDIO) continue;
                for (int i = 0; i < group.length; i++) {
                    if (!group.isTrackSupported(i)) continue;
                    int index = i;
                    Format format = group.getTrackFormat(i);
                    options.add(
                        new TrackOption(audioLabel(format, options.size()), group.isTrackSelected(i), () ->
                            selectExoTrack(group, index, C.TRACK_TYPE_AUDIO)
                        )
                    );
                }
            }
            return options;
        }
        if (vlcPlayer != null) {
            MediaPlayer.TrackDescription[] tracks = vlcPlayer.getAudioTracks();
            if (tracks == null) return options;
            int selected = vlcPlayer.getAudioTrack();
            for (MediaPlayer.TrackDescription track : tracks) {
                options.add(new TrackOption(track.name, track.id == selected, () -> vlcPlayer.setAudioTrack(track.id)));
            }
        }
        return options;
    }

    private List<TrackOption> subtitleTracks() {
        List<TrackOption> options = new ArrayList<>();
        if (player != null) {
            boolean off = player.getTrackSelectionParameters().disabledTrackTypes.contains(C.TRACK_TYPE_TEXT);
            List<TrackOption> found = new ArrayList<>();
            for (Tracks.Group group : player.getCurrentTracks().getGroups()) {
                if (group.getType() != C.TRACK_TYPE_TEXT) continue;
                for (int i = 0; i < group.length; i++) {
                    if (!group.isTrackSupported(i)) continue;
                    int index = i;
                    Format format = group.getTrackFormat(i);
                    found.add(
                        new TrackOption(subtitleLabel(format, found.size()), !off && group.isTrackSelected(i), () ->
                            selectExoTrack(group, index, C.TRACK_TYPE_TEXT)
                        )
                    );
                }
            }
            if (found.isEmpty()) return options;
            options.add(new TrackOption("Vypnuto", off, this::disableExoSubtitles));
            options.addAll(found);
            return options;
        }
        if (vlcPlayer != null) {
            MediaPlayer.TrackDescription[] tracks = vlcPlayer.getSpuTracks();
            if (tracks == null) return options;
            int selected = vlcPlayer.getSpuTrack();
            for (MediaPlayer.TrackDescription track : tracks) {
                // VLC svoje "Disable" hlásí anglicky, uživatel čte česky.
                String label = track.id == -1 ? "Vypnuto" : track.name;
                options.add(new TrackOption(label, track.id == selected, () -> vlcPlayer.setSpuTrack(track.id)));
            }
        }
        return options;
    }

    private void selectExoTrack(Tracks.Group group, int index, int type) {
        if (player == null) return;
        player.setTrackSelectionParameters(
            player
                .getTrackSelectionParameters()
                .buildUpon()
                .setTrackTypeDisabled(type, false)
                .setOverrideForType(new TrackSelectionOverride(group.getMediaTrackGroup(), index))
                .build()
        );
    }

    private void disableExoSubtitles() {
        if (player == null) return;
        player.setTrackSelectionParameters(
            player
                .getTrackSelectionParameters()
                .buildUpon()
                .clearOverridesOfType(C.TRACK_TYPE_TEXT)
                .setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true)
                .build()
        );
    }

    private String audioLabel(Format format, int order) {
        StringBuilder text = new StringBuilder();
        text.append(language(format, "Stopa " + (order + 1)));
        if (format.channelCount > 0) text.append(" · ").append(format.channelCount).append(" kanály");
        String codec = shortCodec(format.sampleMimeType);
        if (codec != null) text.append(" · ").append(codec);
        return text.toString();
    }

    private String subtitleLabel(Format format, int order) {
        return language(format, "Titulky " + (order + 1));
    }

    private String language(Format format, String fallback) {
        if (format.label != null && !format.label.isEmpty()) return format.label;
        if (format.language == null || format.language.isEmpty()) return fallback;
        try {
            String name = new Locale(format.language).getDisplayLanguage(new Locale("cs"));
            return name.isEmpty() ? format.language : name;
        } catch (Throwable error) {
            return format.language;
        }
    }

    private String shortCodec(String mime) {
        if (mime == null) return null;
        int slash = mime.indexOf('/');
        return slash >= 0 ? mime.substring(slash + 1).toUpperCase(Locale.US) : mime.toUpperCase(Locale.US);
    }

    private String fileInfo() {
        StringBuilder text = new StringBuilder();
        text.append("Přehrávač: ").append(vlcPlayer != null ? "VLC" : "ExoPlayer").append('\n');
        if (player != null) {
            Format video = player.getVideoFormat();
            Format audio = player.getAudioFormat();
            if (video != null) {
                text.append("Obraz: ").append(video.width).append(" × ").append(video.height);
                if (video.frameRate > 0) text.append(String.format(Locale.US, " · %.0f fps", video.frameRate));
                String codec = shortCodec(video.sampleMimeType);
                if (codec != null) text.append(" · ").append(codec);
                text.append('\n');
            }
            if (audio != null) {
                text.append("Zvuk: ").append(shortCodec(audio.sampleMimeType));
                if (audio.sampleRate > 0) text.append(" · ").append(audio.sampleRate).append(" Hz");
                text.append('\n');
            }
        } else if (vlcPlayer != null) {
            try {
                IMedia.VideoTrack video = vlcPlayer.getCurrentVideoTrack();
                if (video != null) {
                    text.append("Obraz: ").append(video.width).append(" × ").append(video.height);
                    if (video.codec != null) text.append(" · ").append(video.codec);
                    text.append('\n');
                }
            } catch (Throwable ignored) {
                // Údaje o stopě jsou příjemnost, ne důvod ke stížnosti.
            }
        }
        long total = duration();
        if (total > 0) text.append("Délka: ").append(clock(total)).append('\n');
        text.append("Zdroj: ").append(source);
        return text.toString();
    }

    // --- jas ------------------------------------------------------------------

    /**
     * Jas okna. Minus jedna znamená "jak má systém".
     *
     * Jas se drží u okna, ne u systému: po zavření filmu se displej vrátí tam,
     * kde byl, a appka nesahá na nastavení telefonu.
     */
    private void applyBrightness(float level) {
        brightness = level;
        try {
            WindowManager.LayoutParams params = getWindow().getAttributes();
            params.screenBrightness = level < 0 ? WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE : Math.min(1f, level);
            getWindow().setAttributes(params);
        } catch (Throwable error) {
            CrashLog.record(this, error);
        }
    }

    /**
     * Kde posuvník začíná.
     *
     * Když si film jas nepřenastavil, ukáže se ten, který má zrovna telefon -
     * jinak by posuvník skočil na nesmyslnou hodnotu a první dotek by jasem
     * trhnul.
     */
    private float currentBrightness() {
        if (brightness >= 0) return brightness;
        try {
            int system = Settings.System.getInt(getContentResolver(), Settings.System.SCREEN_BRIGHTNESS);
            return Math.min(1f, Math.max(0.02f, system / 255f));
        } catch (Throwable error) {
            return 0.5f;
        }
    }

    // --- paměť nastavení -------------------------------------------------------

    private void loadPreferences() {
        try {
            SharedPreferences prefs = getSharedPreferences(VIDEO_PREFS, MODE_PRIVATE);
            brightness = prefs.getFloat(BRIGHTNESS_KEY, -1f);
            speed = prefs.getFloat(SPEED_KEY, 1f);
            picture = clamp(prefs.getInt(PICTURE_KEY, 0), PICTURE_LABELS.length);
            repeat = prefs.getBoolean(REPEAT_KEY, false);
            resumePlayback = prefs.getBoolean(RESUME_KEY, true);
            engine = clamp(prefs.getInt(ENGINE_KEY, ENGINE_AUTO), ENGINE_LABELS.length);
            orientation = clamp(prefs.getInt(ORIENTATION_KEY, 0), ORIENTATION_LABELS.length);
        } catch (Throwable error) {
            CrashLog.record(this, error);
        }
    }

    private void savePreferences() {
        try {
            getSharedPreferences(VIDEO_PREFS, MODE_PRIVATE)
                .edit()
                .putFloat(BRIGHTNESS_KEY, brightness)
                .putFloat(SPEED_KEY, speed)
                .putInt(PICTURE_KEY, picture)
                .putBoolean(REPEAT_KEY, repeat)
                .putBoolean(RESUME_KEY, resumePlayback)
                .putInt(ENGINE_KEY, engine)
                .putInt(ORIENTATION_KEY, orientation)
                .apply();
        } catch (Throwable ignored) {
            // Zapamatovat se nepovedlo - film tím netrpí.
        }
    }

    private String positionKey() {
        return POSITION_PREFIX + Integer.toHexString(source == null ? 0 : source.hashCode());
    }

    private long loadPosition() {
        try {
            return getSharedPreferences(VIDEO_PREFS, MODE_PRIVATE).getLong(positionKey(), 0);
        } catch (Throwable error) {
            return 0;
        }
    }

    /**
     * Kam se uživatel dostal.
     *
     * Úplný začátek a úplný konec se nezapisují: u prvních vteřin není co
     * obnovovat a dokoukaný film by se příště otevřel na titulcích.
     */
    private void savePosition() {
        if (!resumePlayback || source == null) return;
        try {
            long at = position();
            long total = duration();
            boolean worth = at > 15000 && (total <= 0 || total - at > 20000);
            SharedPreferences.Editor edit = getSharedPreferences(VIDEO_PREFS, MODE_PRIVATE).edit();
            if (worth) edit.putLong(positionKey(), at);
            else edit.remove(positionKey());
            edit.apply();
        } catch (Throwable ignored) {
            // Zapamatovat se nepovedlo - film tím netrpí.
        }
    }

    private static int clamp(int value, int length) {
        return value < 0 || value >= length ? 0 : value;
    }

    // --- hlášení uprostřed ------------------------------------------------------

    /** Kolečko a hláška uprostřed. Jeden prvek pro čekání i pro nezdar. */
    private void addStatus() {
        statusBox = new LinearLayout(this);
        statusBox.setOrientation(LinearLayout.VERTICAL);
        statusBox.setGravity(Gravity.CENTER);
        statusBox.setPadding(dp(32), dp(32), dp(32), dp(32));

        spinner = new ProgressBar(this);
        statusBox.addView(spinner, new LinearLayout.LayoutParams(dp(40), dp(40)));

        statusText = new TextView(this);
        statusText.setTextColor(Color.WHITE);
        statusText.setGravity(Gravity.CENTER);
        statusText.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        statusText.setPadding(0, dp(16), 0, 0);
        statusBox.addView(
            statusText,
            new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        );

        statusButton = new Button(this);
        statusButton.setText("Zavřít");
        statusButton.setVisibility(View.GONE);
        statusButton.setOnClickListener(v -> finish());
        statusBox.addView(
            statusButton,
            new LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT)
        );

        root.addView(
            statusBox,
            new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.WRAP_CONTENT, Gravity.CENTER)
        );
    }

    /** Něco se děje a uživatel na to čeká. */
    private void working(String message) {
        if (statusBox == null || surrendered) return;
        statusBox.setVisibility(View.VISIBLE);
        spinner.setVisibility(View.VISIBLE);
        statusButton.setVisibility(View.GONE);
        statusText.setText(message);
    }

    /** Obraz běží - hlášení jde pryč. */
    private void playing() {
        if (statusBox != null && !surrendered) statusBox.setVisibility(View.GONE);
    }

    /** Konec pokusů. Napíše se proč a čeká se na uživatele, nezavírá se. */
    private void surrender(String detail) {
        if (surrendered || isFinishing()) return;
        surrendered = true;
        ticker.removeCallbacks(watchdog);
        CrashLog.note(this, "Video se nepodařilo přehrát: " + detail);
        if (statusBox == null) {
            finish();
            return;
        }
        statusBox.setVisibility(View.VISIBLE);
        spinner.setVisibility(View.GONE);
        statusText.setText("Tohle video se nepodařilo přehrát.\n\n" + detail);
        statusButton.setVisibility(View.VISIBLE);
        showChrome();
    }

    // --- drobnosti ---------------------------------------------------------------

    private static String speedLabel(float value) {
        String text = String.format(Locale.US, "%.2f", value);
        while (text.endsWith("0")) text = text.substring(0, text.length() - 1);
        if (text.endsWith(".")) text = text.substring(0, text.length() - 1);
        return text + "×";
    }

    private static String clock(long millis) {
        if (millis <= 0) return "0:00";
        long total = millis / 1000;
        long hours = total / 3600;
        long minutes = (total % 3600) / 60;
        long seconds = total % 60;
        return hours > 0
            ? String.format(Locale.US, "%d:%02d:%02d", hours, minutes, seconds)
            : String.format(Locale.US, "%d:%02d", minutes, seconds);
    }

    /**
     * Tlačítko s ikonou.
     *
     * Pozadí je vlastní vlnka, ne systémový stisk. Právě systémový stisk uměl
     * za tlačítkem bliknout jako žlutý čtverec - kulatá průsvitná vlnka
     * z vlastní ruky se takhle chovat nemůže.
     */
    private ImageButton iconButton(int icon, String description) {
        ImageButton button = new ImageButton(this);
        button.setImageResource(icon);
        button.setColorFilter(Color.WHITE);
        button.setContentDescription(description);
        button.setBackground(circleBackground());
        button.setPadding(dp(8), dp(8), dp(8), dp(8));
        return button;
    }

    private Drawable circleBackground() {
        ShapeDrawable mask = new ShapeDrawable(new OvalShape());
        return new RippleDrawable(ColorStateList.valueOf(HIGHLIGHT), null, mask);
    }

    private Drawable pillBackground(int fill, int radiusDp) {
        GradientDrawable shape = new GradientDrawable();
        shape.setCornerRadius(dp(radiusDp));
        shape.setColor(fill);
        GradientDrawable mask = new GradientDrawable();
        mask.setCornerRadius(dp(radiusDp));
        mask.setColor(Color.WHITE);
        return new RippleDrawable(ColorStateList.valueOf(HIGHLIGHT), shape, mask);
    }

    private FrameLayout.LayoutParams fill() {
        return new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    /**
     * Video přes celý displej: systémové lišty jdou pryč, gestem se vrátí.
     *
     * Volat až po setContentView, ne před ním. getInsetsController() si sahá na
     * dekoraci okna a ta do té doby neexistuje - na Androidu 15 z toho padá
     * NullPointerException. Tohle byl ten důvod, proč klepnutí na film nedělalo
     * vůbec nic: přehrávač spadl v onCreate dřív, než stihl cokoli nakreslit,
     * a obrazovka zmizela rychleji, než se stačila ukázat.
     *
     * A i tak je celé v try: zabalené lišty jsou pohodlí, ne podmínka
     * přehrávání. Film má jet, i kdyby se jich nešlo zbavit.
     */
    private void hideSystemBars() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                WindowInsetsController controller = getWindow().getInsetsController();
                if (controller != null) {
                    controller.hide(WindowInsets.Type.systemBars());
                    controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                }
            } else {
                View decor = getWindow().getDecorView();
                if (decor != null) {
                    decor.setSystemUiVisibility(
                        View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                            | View.SYSTEM_UI_FLAG_FULLSCREEN
                            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    );
                }
            }
        } catch (Throwable error) {
            CrashLog.record(this, error);
        }
    }

    // --- úklid ---------------------------------------------------------------------

    private void releaseExo() {
        if (view != null) {
            view.setPlayer(null);
            stage.removeView(view);
            view = null;
        }
        if (player != null) {
            player.release();
            player = null;
        }
    }

    private void releaseVlc() {
        if (vlcPlayer != null) {
            vlcPlayer.setEventListener(null);
            vlcPlayer.stop();
            vlcPlayer.detachViews();
            vlcPlayer.release();
            vlcPlayer = null;
        }
        if (vlcView != null) {
            stage.removeView(vlcView);
            vlcView = null;
        }
        if (vlc != null) {
            vlc.release();
            vlc = null;
        }
        closeDescriptor();
    }

    private void closeDescriptor() {
        if (descriptor == null) return;
        try {
            descriptor.close();
        } catch (Exception ignored) {
            // zavřít se nepovedlo - dál se s tím nic dělat nedá
        }
        descriptor = null;
    }

    @Override
    public void onBackPressed() {
        if (settingsOpen()) {
            closeSettings();
            return;
        }
        // Zámek platí i pro tlačítko Zpět - jinak by nechránil před tím
        // nejčastějším omylem.
        if (locked) {
            Toast.makeText(this, "Ovládání je zamčené.", Toast.LENGTH_SHORT).show();
            return;
        }
        super.onBackPressed();
    }

    @Override
    public void onPictureInPictureModeChanged(boolean inPip, Configuration configuration) {
        super.onPictureInPictureModeChanged(inPip, configuration);
        // V malém okně se ovládání nevejde a jen by přebilo obraz.
        if (inPip) {
            closeSettings();
            hideChrome();
        } else {
            showChrome();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        savePosition();
        // V obrazu v obraze přijde onPause taky - a pauza v něm by z okna
        // udělala nehybný obrázek. Přehrávání se zastavuje jen doopravdy.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N && isInPictureInPictureMode()) return;
        if (player != null) player.pause();
        if (vlcPlayer != null && vlcPlayer.isPlaying()) vlcPlayer.pause();
    }

    @Override
    protected void onDestroy() {
        savePosition();
        ticker.removeCallbacksAndMessages(null);
        releaseExo();
        releaseVlc();
        super.onDestroy();
    }
}
