package cz.player.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.ImageButton;
import android.widget.LinearLayout;
import android.widget.SeekBar;
import android.widget.TextView;
import androidx.annotation.OptIn;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;
import java.util.ArrayList;
import java.util.Locale;
import org.videolan.libvlc.LibVLC;
import org.videolan.libvlc.Media;
import org.videolan.libvlc.MediaPlayer;
import org.videolan.libvlc.util.VLCVideoLayout;

/**
 * Přehrávač videa.
 *
 * Film se přehrává **tady**, do jiné aplikace se nikam neodkazuje. Aby to platilo
 * i pro soubory, na které systémové dekodéry nestačí, jsou v aplikaci přehrávače
 * dva:
 *
 * 1. ExoPlayer - rychlý, dekóduje tím, co má telefon v čipu, a nese si hotové
 *    ovládání. Zvládne většinu toho, co v telefonu je.
 * 2. libVLC - jádro VLC. Dekóduje si všechno vlastním kódem, takže mu nevadí
 *    AC3, DTS ani kontejnery, které Android nezná. Za to platí výkonem, proto
 *    naskočí až když první přehrávač ohlásí chybu.
 *
 * Přepnutí je automatické: uživatel u toho nic neřeší, jen film chvíli počká.
 * Obrazovka se vzdá, teprve když neuspěje ani VLC.
 */
@OptIn(markerClass = UnstableApi.class)
public class VideoActivity extends Activity {

    static final String EXTRA_URI = "uri";
    static final String EXTRA_TITLE = "title";

    private String source;
    private String title;
    private FrameLayout root;

    private ExoPlayer player;
    private PlayerView view;

    private LibVLC vlc;
    private MediaPlayer vlcPlayer;
    private VLCVideoLayout vlcView;
    private ParcelFileDescriptor descriptor;
    private View controls;
    private ImageButton toggle;
    private SeekBar bar;
    private TextView clock;
    private boolean dragging;
    private final Handler ticker = new Handler(Looper.getMainLooper());

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Intent intent = getIntent();
        source = intent != null ? intent.getStringExtra(EXTRA_URI) : null;
        title = intent != null ? intent.getStringExtra(EXTRA_TITLE) : null;
        if (source == null || source.isEmpty()) {
            finish();
            return;
        }

        try {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            hideSystemBars();

            root = new FrameLayout(this);
            root.setBackgroundColor(Color.BLACK);
            setContentView(root);

            startExo();
        } catch (Throwable error) {
            CrashLog.record(this, error);
            startVlc();
        }
    }

    /** První pokus: systémové dekodéry přes ExoPlayer. */
    private void startExo() {
        view = new PlayerView(this);
        view.setKeepContentOnPlayerReset(true);
        root.addView(view, fill());

        // Když první dekodér souboru nesedne, zkusí se další v pořadí. Bez
        // tohohle stačí jeden zaseklý dekodér a video "nejde přehrát", přestože
        // ho telefon umí.
        DefaultRenderersFactory renderers = new DefaultRenderersFactory(this)
            .setEnableDecoderFallback(true)
            .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER);

        player = new ExoPlayer.Builder(this, renderers).build();
        player.addListener(
            new Player.Listener() {
                @Override
                public void onPlayerError(PlaybackException error) {
                    CrashLog.note(VideoActivity.this, "Video: " + error.getErrorCodeName() + " -> VLC");
                    startVlc();
                }

                @Override
                public void onPlaybackStateChanged(int state) {
                    if (state == Player.STATE_READY) ticker.removeCallbacks(watchdog);
                }
            }
        );
        view.setPlayer(player);
        player.setMediaItem(MediaItem.fromUri(Uri.parse(source)));
        player.prepare();
        player.setPlayWhenReady(true);
        ticker.postDelayed(watchdog, 9000);
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
            CrashLog.note(VideoActivity.this, "Video: ExoPlayer se nerozjel -> VLC");
            startVlc();
        }
    };

    /**
     * Druhý pokus: libVLC.
     *
     * Dekóduje vlastním kódem, takže si poradí i s tím, co telefon v systému
     * nemá. Ovládání je vlastní - libVLC kreslí jen obraz, tlačítka k němu
     * žádná nepatří.
     */
    private void startVlc() {
        if (vlcPlayer != null) return;

        ticker.removeCallbacks(watchdog);
        releaseExo();
        try {
            if (root.getChildCount() > 0) root.removeAllViews();

            ArrayList<String> options = new ArrayList<>();
            // Zahazování snímků se u filmů projeví trháním obrazu; radši ne.
            options.add("--no-drop-late-frames");
            options.add("--no-skip-frames");
            options.add("--audio-time-stretch");
            vlc = new LibVLC(this, options);

            vlcView = new VLCVideoLayout(this);
            root.addView(vlcView, fill());
            addControls();

            vlcPlayer = new MediaPlayer(vlc);
            vlcPlayer.attachViews(vlcView, null, false, false);
            vlcPlayer.setEventListener(
                event -> {
                    if (event.type == MediaPlayer.Event.EncounteredError) showProblem("přehrávač si se souborem neporadil");
                    if (event.type == MediaPlayer.Event.EndReached) finish();
                    if (event.type == MediaPlayer.Event.Playing || event.type == MediaPlayer.Event.Paused) refreshToggle();
                }
            );

            Uri parsed = Uri.parse(source);
            Media media;
            if ("content".equals(parsed.getScheme())) {
                // Adresu `content://` VLC sám neotevře - dostane rovnou otevřený
                // soubor. Popisovač proto musí žít až do konce přehrávání.
                descriptor = getContentResolver().openFileDescriptor(parsed, "r");
                if (descriptor == null) {
                    showProblem("soubor se nepodařilo otevřít");
                    return;
                }
                media = new Media(vlc, descriptor.getFileDescriptor());
            } else {
                media = new Media(vlc, parsed);
            }
            media.setHWDecoderEnabled(true, true);
            vlcPlayer.setMedia(media);
            media.release();
            vlcPlayer.play();

            ticker.post(tick);
        } catch (Throwable error) {
            CrashLog.record(this, error);
            showProblem(error.getClass().getSimpleName());
        }
    }

    /** Ovládání k VLC: pozastavit, posunout se, vidět čas a název filmu. */
    private void addControls() {
        LinearLayout column = new LinearLayout(this);
        column.setOrientation(LinearLayout.VERTICAL);
        column.setBackgroundColor(Color.argb(140, 0, 0, 0));
        column.setPadding(dp(16), dp(12), dp(16), dp(20));

        if (title != null && !title.isEmpty()) {
            TextView name = new TextView(this);
            name.setText(title);
            name.setTextColor(Color.WHITE);
            name.setMaxLines(1);
            name.setTextSize(TypedValue.COMPLEX_UNIT_SP, 14);
            name.setPadding(0, 0, 0, dp(8));
            column.addView(name);
        }

        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);

        toggle = new ImageButton(this);
        toggle.setBackgroundColor(Color.TRANSPARENT);
        toggle.setImageResource(android.R.drawable.ic_media_pause);
        toggle.setColorFilter(Color.WHITE);
        toggle.setOnClickListener(v -> {
            if (vlcPlayer == null) return;
            if (vlcPlayer.isPlaying()) vlcPlayer.pause();
            else vlcPlayer.play();
            refreshToggle();
        });
        row.addView(toggle, new LinearLayout.LayoutParams(dp(44), dp(44)));

        bar = new SeekBar(this);
        bar.setMax(1000);
        bar.setOnSeekBarChangeListener(
            new SeekBar.OnSeekBarChangeListener() {
                @Override
                public void onProgressChanged(SeekBar seekBar, int progress, boolean fromUser) {}

                @Override
                public void onStartTrackingTouch(SeekBar seekBar) {
                    dragging = true;
                }

                @Override
                public void onStopTrackingTouch(SeekBar seekBar) {
                    dragging = false;
                    if (vlcPlayer != null) vlcPlayer.setPosition(seekBar.getProgress() / 1000f);
                }
            }
        );
        LinearLayout.LayoutParams barSize = new LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f);
        barSize.setMargins(dp(8), 0, dp(8), 0);
        row.addView(bar, barSize);

        clock = new TextView(this);
        clock.setTextColor(Color.WHITE);
        clock.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        clock.setText("0:00");
        row.addView(clock);

        column.addView(row);

        FrameLayout.LayoutParams place = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.BOTTOM
        );
        root.addView(column, place);
        controls = column;

        // Klepnutí do obrazu ovládání schová - film má být vidět celý.
        vlcView.setOnClickListener(v -> controls.setVisibility(controls.getVisibility() == View.VISIBLE ? View.GONE : View.VISIBLE));
    }

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (vlcPlayer != null && bar != null && !dragging) {
                long length = vlcPlayer.getLength();
                long time = vlcPlayer.getTime();
                if (length > 0) bar.setProgress((int) (time * 1000 / length));
                clock.setText(clock(time) + " / " + clock(length));
            }
            ticker.postDelayed(this, 500);
        }
    };

    private void refreshToggle() {
        if (toggle == null || vlcPlayer == null) return;
        toggle.setImageResource(vlcPlayer.isPlaying() ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play);
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

    /** Když neuspěl ani VLC, napíše se to na obrazovku i s důvodem. */
    private void showProblem(String detail) {
        try {
            if (root == null) {
                finish();
                return;
            }
            root.removeAllViews();

            TextView message = new TextView(this);
            message.setTextColor(Color.WHITE);
            message.setGravity(Gravity.CENTER);
            message.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
            message.setPadding(dp(24), dp(24), dp(24), dp(24));
            message.setText("Tohle video se nepodařilo přehrát.\n\n" + detail + "\n\nZpět gestem nebo tlačítkem.");
            root.addView(message, fill());
        } catch (Throwable ignored) {
            finish();
        }
    }

    private FrameLayout.LayoutParams fill() {
        return new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT);
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    /** Video přes celý displej: systémové lišty jdou pryč, gestem se vrátí. */
    private void hideSystemBars() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.systemBars());
                controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
            }
        } else {
            getWindow()
                .getDecorView()
                .setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_FULLSCREEN
                        | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                        | View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                );
        }
    }

    private void releaseExo() {
        if (view != null) {
            view.setPlayer(null);
            root.removeView(view);
            view = null;
        }
        if (player != null) {
            player.release();
            player = null;
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (player != null) player.pause();
        if (vlcPlayer != null && vlcPlayer.isPlaying()) vlcPlayer.pause();
    }

    @Override
    protected void onDestroy() {
        ticker.removeCallbacksAndMessages(null);
        releaseExo();
        if (vlcPlayer != null) {
            vlcPlayer.stop();
            vlcPlayer.detachViews();
            vlcPlayer.release();
            vlcPlayer = null;
        }
        if (vlc != null) {
            vlc.release();
            vlc = null;
        }
        if (descriptor != null) {
            try {
                descriptor.close();
            } catch (Exception ignored) {
                // zavřít se nepovedlo - dál se s tím nic dělat nedá
            }
            descriptor = null;
        }
        super.onDestroy();
    }
}
