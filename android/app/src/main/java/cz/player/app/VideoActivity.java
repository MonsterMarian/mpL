package cz.player.app;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.widget.FrameLayout;
import android.widget.TextView;
import androidx.annotation.OptIn;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.Player;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;

/**
 * Přehrávač videa.
 *
 * Video běží v ExoPlayeru: WebView uměl jen webové kodeky, takže na filmech
 * (MKV, HEVC) mlčel. ExoPlayer si nese vlastní rozbalovače kontejnerů, takže
 * MKV, AVI ani MOV pro něj nejsou problém, a obraz se zvukem dekóduje tím, co
 * má telefon v systému.
 *
 * Přehrává se **tady**, ne v cizí aplikaci. Když dekodér selže, zkusí se druhý
 * v pořadí (`setEnableDecoderFallback`) - výrobci jich do telefonu dávají víc
 * a první nemusí souboru sednout. Teprve když neuspěje ani jeden, obrazovka to
 * napíše i s kódem chyby, ať je vidět, co přesně chybí.
 *
 * Obyčejná `Activity` a systémové téma schválně: PlayerView žádnou knihovnu
 * témat nepotřebuje a čím míň věcí se tu musí najít v prostředcích, tím míň
 * má obrazovka jak spadnout.
 */
@OptIn(markerClass = UnstableApi.class)
public class VideoActivity extends Activity {

    static final String EXTRA_URI = "uri";
    static final String EXTRA_TITLE = "title";

    private ExoPlayer player;
    private PlayerView view;
    private FrameLayout root;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Intent intent = getIntent();
        String uri = intent != null ? intent.getStringExtra(EXTRA_URI) : null;
        if (uri == null || uri.isEmpty()) {
            finish();
            return;
        }

        try {
            getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            hideSystemBars();

            root = new FrameLayout(this);
            root.setBackgroundColor(Color.BLACK);
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

            // Když první dekodér souboru nesedne, zkusí se další v pořadí.
            // Bez tohohle stačí jeden zaseklý dekodér a video "nejde přehrát",
            // přestože ho telefon umí.
            DefaultRenderersFactory renderers = new DefaultRenderersFactory(this)
                .setEnableDecoderFallback(true)
                .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_PREFER);

            player = new ExoPlayer.Builder(this, renderers).build();
            player.addListener(
                new Player.Listener() {
                    @Override
                    public void onPlayerError(PlaybackException error) {
                        CrashLog.note(VideoActivity.this, "Video: " + error.getErrorCodeName());
                        showProblem(error);
                    }
                }
            );
            view.setPlayer(player);
            player.setMediaItem(MediaItem.fromUri(Uri.parse(uri)));
            player.prepare();
            player.setPlayWhenReady(true);
        } catch (Throwable error) {
            CrashLog.record(this, error);
            showProblem(null);
        }
    }

    /**
     * Co se nepovedlo, se napíše na obrazovku.
     *
     * Do jiné aplikace se nikam neodkazuje - film patří sem. Kód chyby je
     * v textu schválně: podle něj se pozná, jestli chybí dekodér obrazu, zvuku,
     * nebo je vadný soubor.
     */
    private void showProblem(PlaybackException error) {
        try {
            if (root == null) {
                finish();
                return;
            }
            if (view != null) view.setVisibility(View.GONE);

            TextView message = new TextView(this);
            message.setTextColor(Color.WHITE);
            message.setGravity(Gravity.CENTER);
            message.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
            message.setPadding(48, 48, 48, 48);
            String detail = error != null ? error.getErrorCodeName() : "neznámá chyba";
            message.setText("Tohle video se nepodařilo přehrát.\n\n" + detail + "\n\nZpět gestem nebo tlačítkem.");

            root.addView(
                message,
                new FrameLayout.LayoutParams(
                    FrameLayout.LayoutParams.MATCH_PARENT,
                    FrameLayout.LayoutParams.MATCH_PARENT
                )
            );
        } catch (Throwable ignored) {
            finish();
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
