package cz.player.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import androidx.annotation.OptIn;
import androidx.appcompat.app.AppCompatActivity;
import androidx.media3.common.MediaItem;
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
 * Vlastní obrazovka schválně: video patří přes celý displej a nemá se prát
 * s lištami appky ani s WebView pod sebou.
 */
@OptIn(markerClass = UnstableApi.class)
public class VideoActivity extends AppCompatActivity {

    static final String EXTRA_URI = "uri";
    static final String EXTRA_TITLE = "title";

    private ExoPlayer player;
    private PlayerView view;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        hideSystemBars();

        view = new PlayerView(this);
        view.setKeepContentOnPlayerReset(true);
        setContentView(view);

        Intent intent = getIntent();
        String uri = intent != null ? intent.getStringExtra(EXTRA_URI) : null;
        if (uri == null || uri.isEmpty()) {
            finish();
            return;
        }

        player = new ExoPlayer.Builder(this).build();
        view.setPlayer(player);
        player.setMediaItem(MediaItem.fromUri(Uri.parse(uri)));
        player.prepare();
        player.setPlayWhenReady(true);
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
