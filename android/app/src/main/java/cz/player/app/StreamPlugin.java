package cz.player.app;

import android.content.Intent;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.schabi.newpipe.extractor.NewPipe;
import org.schabi.newpipe.extractor.ServiceList;
import org.schabi.newpipe.extractor.downloader.Downloader;
import org.schabi.newpipe.extractor.exceptions.ReCaptchaException;
import org.schabi.newpipe.extractor.search.SearchInfo;
import org.schabi.newpipe.extractor.stream.AudioStream;
import org.schabi.newpipe.extractor.stream.StreamInfo;
import org.schabi.newpipe.extractor.stream.StreamInfoItem;
import org.schabi.newpipe.extractor.stream.VideoStream;

/**
 * Zjištění adresy streamu.
 *
 * YouTube nemá veřejné API na stažení souboru, takže adresu vytáhne
 * NewPipeExtractor - stejná knihovna, na které stojí NewPipe. Vrací se jen
 * adresa a název; samotné stahování pak obstará systémový DownloadManager
 * (viz `MediaLibraryPlugin.download`).
 *
 * Odkaz na Spotify se **nerozebírá** - jeho obsah je chráněný a na tu ochranu
 * se tady nesahá. Ze stránky se přečte jen veřejný název a interpret a podle
 * nich se skladba najde na YouTube, stejně jako to dělá spotdl.
 */
@CapacitorPlugin(name = "Stream")
public class StreamPlugin extends Plugin {

    private static final String USER_AGENT =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final OkHttpClient http = new OkHttpClient();
    private boolean extractorReady = false;

    /** Poslední pád nativní části - Nastavení ho umí ukázat. */
    @PluginMethod
    public void lastCrash(PluginCall call) {
        JSObject result = new JSObject();
        result.put("crash", CrashLog.read(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void clearCrash(PluginCall call) {
        CrashLog.clear(getContext());
        call.resolve();
    }

    /**
     * Spustí nativní přehrávač videa (ExoPlayer, v záloze VLC) - ten umí i to,
     * co WebView ne.
     *
     * Soubor se otevře **ještě tady**, dřív než se pustí přehrávač. Nečitelný
     * soubor tak skončí chybou, kterou appka umí ukázat, místo aby se rozsvítila
     * a hned zhasla cizí obrazovka - to v telefonu vypadá, jako by klepnutí na
     * film neudělalo vůbec nic.
     */
    @PluginMethod
    public void playVideo(PluginCall call) {
        String uri = call.getString("uri");
        if (uri == null || uri.trim().isEmpty()) {
            call.reject("Chybí adresa videa.", "STREAM_BAD_REQUEST");
            return;
        }
        try {
            Uri parsed = Uri.parse(uri.trim());
            if ("content".equals(parsed.getScheme())) {
                try (ParcelFileDescriptor probe = getContext().getContentResolver().openFileDescriptor(parsed, "r")) {
                    if (probe == null) {
                        call.reject("Soubor se nepodařilo otevřít.", "STREAM_UNREADABLE");
                        return;
                    }
                } catch (SecurityException error) {
                    call.reject("Aplikace nemá přístup k tomuhle souboru.", "STREAM_FORBIDDEN", error);
                    return;
                } catch (FileNotFoundException error) {
                    call.reject("Soubor v telefonu už není.", "STREAM_MISSING", error);
                    return;
                }
            }

            Intent intent = new Intent(getContext(), VideoActivity.class)
                .putExtra(VideoActivity.EXTRA_URI, uri)
                .putExtra(VideoActivity.EXTRA_TITLE, call.getString("title", ""))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            CrashLog.record(getContext(), error);
            call.reject("Přehrávač se nepodařilo otevřít.", "STREAM_PLAY_FAILED", error);
        }
    }

    /**
     * Najde adresu souboru za odkazem.
     *
     * `kind` je "audio" (do hudby) nebo "video". Práce jde na vlastní vlákno -
     * síť na hlavním vlákně Android zakazuje a rozbor stránky trvá vteřiny.
     */
    @PluginMethod
    public void resolve(PluginCall call) {
        String link = call.getString("url");
        if (link == null || link.trim().isEmpty()) {
            call.reject("Chybí odkaz.", "STREAM_BAD_REQUEST");
            return;
        }
        boolean audioOnly = !"video".equals(call.getString("kind", "audio"));

        worker.execute(() -> {
            try {
                prepareExtractor();
                String url = link.trim();

                // Spotify: z jeho stránky se bere jen veřejný popis, nic víc.
                if (url.contains("spotify.")) {
                    String query = spotifyTitle(url);
                    if (query == null) {
                        call.reject("Ze Spotify se nepodařilo přečíst název skladby.", "STREAM_LOOKUP_FAILED");
                        return;
                    }
                    url = firstYoutubeResult(query);
                    if (url == null) {
                        call.reject("Na YouTube se nic takového nenašlo.", "STREAM_LOOKUP_FAILED");
                        return;
                    }
                } else if (!url.startsWith("http")) {
                    // Cokoliv, co není adresa, je hledaný text.
                    String found = firstYoutubeResult(url);
                    if (found == null) {
                        call.reject("Nic takového se nenašlo.", "STREAM_LOOKUP_FAILED");
                        return;
                    }
                    url = found;
                }

                StreamInfo info = StreamInfo.getInfo(ServiceList.YouTube, url);
                JSObject result = new JSObject();
                result.put("title", info.getName());
                result.put("author", info.getUploaderName());
                result.put("durationSeconds", info.getDuration());

                if (audioOnly) {
                    AudioStream best = bestAudio(info.getAudioStreams());
                    if (best == null) {
                        call.reject("U téhle skladby není zvuková stopa ke stažení.", "STREAM_NO_AUDIO");
                        return;
                    }
                    result.put("url", best.getContent());
                    result.put("extension", extensionOf(best.getFormat() != null ? best.getFormat().getSuffix() : "m4a"));
                } else {
                    VideoStream best = bestVideo(info.getVideoStreams());
                    if (best == null) {
                        call.reject("U tohohle videa není stopa ke stažení.", "STREAM_NO_VIDEO");
                        return;
                    }
                    result.put("url", best.getContent());
                    result.put("extension", extensionOf(best.getFormat() != null ? best.getFormat().getSuffix() : "mp4"));
                }

                call.resolve(result);
            } catch (Exception error) {
                call.reject("Odkaz se nepodařilo rozebrat: " + error.getMessage(), "STREAM_RESOLVE_FAILED", error);
            }
        });
    }

    /** Nejlepší zvuk podle datového toku - vyšší číslo, lepší poslech. */
    private AudioStream bestAudio(List<AudioStream> streams) {
        AudioStream best = null;
        for (AudioStream stream : streams) {
            if (stream.getContent() == null || stream.getContent().isEmpty()) continue;
            if (best == null || stream.getAverageBitrate() > best.getAverageBitrate()) best = stream;
        }
        return best;
    }

    /**
     * Nejlepší video, které má i zvuk.
     *
     * YouTube nabízí ve vysokém rozlišení obraz a zvuk zvlášť a spojit je jde
     * jen převodem, na který v telefonu nic není. Bere se proto nejvyšší
     * z těch, které mají obojí v jednom souboru.
     */
    private VideoStream bestVideo(List<VideoStream> streams) {
        VideoStream best = null;
        for (VideoStream stream : streams) {
            if (stream.getContent() == null || stream.getContent().isEmpty()) continue;
            if (stream.isVideoOnly()) continue;
            if (best == null || height(stream) > height(best)) best = stream;
        }
        return best;
    }

    private int height(VideoStream stream) {
        try {
            String resolution = stream.getResolution();
            if (resolution == null) return 0;
            return Integer.parseInt(resolution.replaceAll("[^0-9].*$", ""));
        } catch (Exception error) {
            return 0;
        }
    }

    private String extensionOf(String suffix) {
        if (suffix == null || suffix.trim().isEmpty()) return "m4a";
        return suffix.replace(".", "").trim();
    }

    /** Veřejný popis skladby ze Spotify - jen název a interpret, nic z obsahu. */
    private String spotifyTitle(String url) {
        Request request = new Request.Builder()
            .url("https://open.spotify.com/oembed?url=" + url)
            .header("User-Agent", USER_AGENT)
            .build();
        try (Response response = http.newCall(request).execute()) {
            ResponseBody body = response.body();
            if (!response.isSuccessful() || body == null) return null;
            String json = body.string();
            String title = between(json, "\"title\":\"", "\"");
            return title != null ? title.replace("\\/", "/") : null;
        } catch (IOException error) {
            return null;
        }
    }

    private String between(String source, String from, String to) {
        int start = source.indexOf(from);
        if (start < 0) return null;
        start += from.length();
        int end = source.indexOf(to, start);
        return end > start ? source.substring(start, end) : null;
    }

    private String firstYoutubeResult(String query) throws Exception {
        SearchInfo search = SearchInfo.getInfo(
            ServiceList.YouTube,
            ServiceList.YouTube.getSearchQHFactory().fromQuery(query)
        );
        for (Object item : search.getRelatedItems()) {
            if (item instanceof StreamInfoItem) {
                return ((StreamInfoItem) item).getUrl();
            }
        }
        return null;
    }

    /** NewPipe chce vlastní stahovač; jednou za běh stačí. */
    private synchronized void prepareExtractor() {
        if (extractorReady) return;
        NewPipe.init(new OkHttpDownloader(http));
        extractorReady = true;
    }

    /** Most mezi NewPipe a OkHttp - knihovna si síť neřeší sama. */
    private static final class OkHttpDownloader extends Downloader {

        private final OkHttpClient client;

        private OkHttpDownloader(OkHttpClient client) {
            this.client = client;
        }

        @Override
        public org.schabi.newpipe.extractor.downloader.Response execute(
            org.schabi.newpipe.extractor.downloader.Request request
        ) throws IOException, ReCaptchaException {
            Request.Builder builder = new Request.Builder()
                .method(
                    request.httpMethod(),
                    request.dataToSend() != null
                        ? okhttp3.RequestBody.create(request.dataToSend())
                        : null
                )
                .url(request.url())
                .header("User-Agent", USER_AGENT);

            for (java.util.Map.Entry<String, List<String>> header : request.headers().entrySet()) {
                for (String value : header.getValue()) {
                    builder.addHeader(header.getKey(), value);
                }
            }

            try (Response response = client.newCall(builder.build()).execute()) {
                if (response.code() == 429) {
                    throw new ReCaptchaException("YouTube chce ověření, že nejsi robot.", request.url());
                }
                ResponseBody body = response.body();
                return new org.schabi.newpipe.extractor.downloader.Response(
                    response.code(),
                    response.message(),
                    response.headers().toMultimap(),
                    body != null ? body.string() : null,
                    response.request().url().toString()
                );
            }
        }
    }
}
