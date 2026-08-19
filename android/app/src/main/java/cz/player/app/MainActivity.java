package cz.player.app;

import android.content.IntentSender;
import android.os.Bundle;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * Systémové potvrzení, které si od Androidu 11 vyžádá každé mazání cizího
     * souboru. Otevírá se přes IntentSender a odpověď chodí aktivitě, ne
     * pluginu - launcher proto sedí tady. Registrovat se musí ještě za běhu
     * `onCreate`, později ho androidx odmítne.
     */
    private ActivityResultLauncher<IntentSenderRequest> confirmLauncher;
    private Runnable onConfirmed;
    private Runnable onRefused;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MediaLibraryPlugin.class);
        registerPlugin(PlaybackPlugin.class);
        registerPlugin(StreamPlugin.class);
        super.onCreate(savedInstanceState);
        confirmLauncher = registerForActivityResult(
            new ActivityResultContracts.StartIntentSenderForResult(),
            result -> {
                Runnable done = result.getResultCode() == RESULT_OK ? onConfirmed : onRefused;
                onConfirmed = null;
                onRefused = null;
                if (done != null) done.run();
            }
        );
    }

    /** Ukáže systémové okno a podle odpovědi pustí dál jednu z obou větví. */
    void confirmWithSystem(IntentSender sender, Runnable confirmed, Runnable refused) {
        if (confirmLauncher == null) {
            refused.run();
            return;
        }
        onConfirmed = confirmed;
        onRefused = refused;
        try {
            confirmLauncher.launch(new IntentSenderRequest.Builder(sender).build());
        } catch (Exception error) {
            // Rozbitý IntentSender nesmí shodit appku - mazání prostě neproběhne.
            onConfirmed = null;
            onRefused = null;
            refused.run();
        }
    }
}
