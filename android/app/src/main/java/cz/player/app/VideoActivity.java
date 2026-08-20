package cz.player.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.widget.FrameLayout;
import androidx.annotation.OptIn;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;

/**
 * Přehrávač videa.
 *
 * Video běží v ExoPlayeru, ne ve WebView: ten umí jen webové kodeky, takže na
 * filmech (MKV, HEVC) mlčel. ExoPlayer zvládne, co má Android v systému, a nese
 * si vlastní ovládání - posuvník, časy, rychlost - takže ho appka nemusí
 * kreslit znovu.
 *
 * Obyčejná `Activity` a systémové téma schválně: PlayerView žádnou knihovnu
 * témat nepotřebuje a čím míň věcí se tu musí najít v prostředcích, tím míň
 * má obrazovka jak spadnout.
 *
 * Když se přehrávač nerozjede (chybí kodek, soubor je pryč), obrazovka se
 * nezhroutí - pošle video do jiné aplikace a zavře se.
 */
@OptIn(markerClass = UnstableApi.class)
public class VideoActivity extends Activity {

    static final String EXTRA_URI = "uri";
    static final String EXTRA_TITLE = "title";

    private ExoPlayer player;
    private PlayerView view;
    private String uri;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Intent intent = getIntent();
        uri = intent != null ? intent.getStringExtra(EXTRA_URI) : null;
        if (uri == null || uri.isEmpty()) {
            finish();
            return;
        }

        try {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            hideSystemBars();

            FrameLayout root = new FrameLayout(this);
            root.setBackgroundColor(0xFF000000);
            view = new PlayerView(this);
            view.setKeepContentOnPlayerReset(true);
            root.addView(
                view,
                new FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT
                )
            );
            setContentView(root);

            player = new ExoPlayer.Builder(this).build();
            player.addListener(
                new Player.Listener() {
                    @Override
                    public void onPlayerError(PlaybackException error) {
                        // Kodek, který Android nemá, nemá cenu obcházet - ať se
                        // toho ujme přehrávač, který ho umí.
                        CrashLog.note(VideoActivity.this, "Video: " + error.getErrorCodeName());
                        openElsewhere();
                    }
                }
            );
            view.setPlayer(player);
            player.setMediaItem(MediaItem.fromUri(Uri.parse(uri)));
            player.prepare();
            player.setPlayWhenReady(true);
        } catch (Throwable error) {
            CrashLog.record(this, error);
            openElsewhere();
        }
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

    private void openElsewhere() {
        try {
            Intent open = new Intent(Intent.ACTION_VIEW)
                .setDataAndType(Uri.parse(uri), "video/*")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(Intent.createChooser(open, "Otevřít v"));
        } catch (Exception ignored) {
            // Žádný přehrávač v telefonu - víc se dělat nedá.
        }
        finish();
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (player != null) player.pause();
    }

    @Override
    protected void onDestroy() {
        if (view != null) view.setPlayer(null);
        if (player != null) {
            player.release();
            player = null;
        }
        super.onDestroy();
    }
}
