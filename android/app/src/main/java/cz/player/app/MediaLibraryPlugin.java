package cz.player.app;

import android.Manifest;
import android.app.PendingIntent;
import android.app.RecoverableSecurityException;
import android.app.DownloadManager;
import android.content.ContentResolver;
import android.content.Context;
import android.content.ContentUris;
import android.content.Intent;
import android.content.IntentSender;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.pdf.PdfRenderer;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.provider.MediaStore;
import android.provider.Settings;
import android.util.Base64;
import android.util.Size;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;

@CapacitorPlugin(
    name = "MediaLibrary",
    permissions = {
        @Permission(alias = "media", strings = { Manifest.permission.READ_MEDIA_AUDIO }),
        @Permission(alias = "video", strings = { Manifest.permission.READ_MEDIA_VIDEO }),
        @Permission(alias = "storage", strings = { Manifest.permission.READ_EXTERNAL_STORAGE }),
        @Permission(alias = "write", strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE })
    }
)
public class MediaLibraryPlugin extends Plugin {

    /** Obaly alb má MediaStore pod vlastní adresou, ne u samotné skladby. */
    private static final Uri ALBUM_ART_URI = Uri.parse("content://media/external/audio/albumart");

    private String permissionAlias() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ? "media" : "storage";
    }

    /**
     * Od Androidu 13 se hudba a video povolují zvlášť (READ_MEDIA_AUDIO
     * a READ_MEDIA_VIDEO). Starší systémy mají jediné READ_EXTERNAL_STORAGE
     * pro obojí, takže tam obě větve míří na totéž.
     */
    private String videoPermissionAlias() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ? "video" : "storage";
    }

    private boolean hasMediaPermission() {
        String permission = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            ? Manifest.permission.READ_MEDIA_AUDIO
            : Manifest.permission.READ_EXTERNAL_STORAGE;
        return ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasVideoPermission() {
        String permission = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            ? Manifest.permission.READ_MEDIA_VIDEO
            : Manifest.permission.READ_EXTERNAL_STORAGE;
        return ContextCompat.checkSelfPermission(getContext(), permission) == PackageManager.PERMISSION_GRANTED;
    }

    @PluginMethod
    public void checkPermission(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", hasMediaPermission());
        call.resolve(result);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (hasMediaPermission()) {
            call.resolve();
            return;
        }
        requestPermissionForAlias(permissionAlias(), call, "permissionCallback");
    }

    @PluginMethod
    public void checkVideoPermission(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", hasVideoPermission());
        call.resolve(result);
    }

    @PluginMethod
    public void requestVideoPermission(PluginCall call) {
        if (hasVideoPermission()) {
            call.resolve();
            return;
        }
        requestPermissionForAlias(videoPermissionAlias(), call, "videoPermissionCallback");
    }

    @PermissionCallback
    private void videoPermissionCallback(PluginCall call) {
        if (hasVideoPermission()) {
            call.resolve();
        } else {
            call.reject("Přístup k videím nebyl povolen.", "MEDIA_PERMISSION_DENIED");
        }
    }

    /**
     * Dokumenty v telefonu.
     *
     * PDF ani EPUB nejsou z pohledu Androidu média, takže je nekryje povolení
     * k hudbě ani k videím - na jejich čtení chce systém od Androidu 11
     * „přístup ke všem souborům". Bez něj se vrátí prázdno a appka nabídne
     * povolení; ručně vybraný soubor funguje tak jako tak.
     */
    /** Co se počítá jako dokument. Podle přípony, protože MIME typ často chybí. */
    private static final String[] DOC_EXTENSIONS = { ".pdf", ".epub", ".txt", ".md" };

    /** Kam se při procházení úložiště nechodí - jsou to data aplikací, ne knihovna. */
    private static final Set<String> SKIPPED_DIRS = new HashSet<>(
        Arrays.asList("data", "obb", ".thumbnails", ".trash", "cache")
    );

    /** Pojistka proti telefonu plnému složek - hlouběji a dál se nechodí. */
    private static final int MAX_SCAN_DEPTH = 12;
    private static final int MAX_DOCUMENTS = 3000;

    @PluginMethod
    public void listDocuments(PluginCall call) {
        if (!hasAllFiles()) {
            JSObject empty = new JSObject();
            empty.put("granted", false);
            empty.put("documents", new JSONArray());
            call.resolve(empty);
            return;
        }

        // Klíčem je cesta k souboru: stejnou knihu najde MediaStore i procházení
        // úložiště a v seznamu má být jednou.
        Map<String, JSObject> found = new LinkedHashMap<>();
        try {
            collectFromMediaStore(found);
            // MediaStore zná jen to, co mu při skenu prošlo pod rukama. Knihy
            // nakopírované přes kabel, stažené cizí aplikací nebo bez MIME typu
            // v něm chybí - proto se úložiště ještě projde napřímo.
            for (File root : storageRoots()) collectFromStorage(root, root, 0, found);
        } catch (Exception error) {
            call.reject("Dokumenty se nepodařilo přečíst.", "MEDIA_READ_FAILED", error);
            return;
        }

        List<JSObject> sorted = new ArrayList<>(found.values());
        // Nejnovější nahoře - stejné pořadí, jaké dřív vracel MediaStore.
        Collections.sort(sorted, (left, right) -> Long.compare(right.optLong("addedAt"), left.optLong("addedAt")));

        JSONArray documents = new JSONArray();
        for (JSObject document : sorted) documents.put(document);

        JSObject result = new JSObject();
        result.put("granted", true);
        result.put("documents", documents);
        call.resolve(result);
    }

    /**
     * Dokumenty, o kterých ví MediaStore.
     *
     * Hledá se podle MIME typu **i** podle přípony: spousta souborů má v databázi
     * MIME prázdné nebo `application/octet-stream` a při hledání jen podle typu
     * propadly. A projdou se všechny svazky, ne jen vnitřní paměť - na paměťové
     * kartě je knihovna vedená zvlášť.
     */
    private void collectFromMediaStore(Map<String, JSObject> found) {
        String[] projection = {
            MediaStore.Files.FileColumns._ID,
            MediaStore.Files.FileColumns.DISPLAY_NAME,
            MediaStore.Files.FileColumns.SIZE,
            MediaStore.Files.FileColumns.DATE_ADDED,
            MediaStore.Files.FileColumns.MIME_TYPE,
            MediaStore.Files.FileColumns.RELATIVE_PATH,
            MediaStore.Files.FileColumns.DATA
        };

        StringBuilder selection = new StringBuilder(MediaStore.Files.FileColumns.MIME_TYPE + " IN (?,?,?,?)");
        List<String> args = new ArrayList<>(
            Arrays.asList("application/pdf", "application/epub+zip", "text/plain", "text/markdown")
        );
        for (String extension : DOC_EXTENSIONS) {
            // LIKE v SQLite nerozlišuje velikost písmen, takže sedne i na ".PDF".
            selection.append(" OR ").append(MediaStore.Files.FileColumns.DISPLAY_NAME).append(" LIKE ?");
            args.add("%" + extension);
        }

        for (String volume : documentVolumes()) {
            Uri content;
            try {
                content = MediaStore.Files.getContentUri(volume);
            } catch (Exception ignored) {
                continue;
            }

            Cursor cursor = null;
            try {
                cursor =
                    getContext()
                        .getContentResolver()
                        .query(content, projection, selection.toString(), args.toArray(new String[0]), null);
                if (cursor == null) continue;

                int idIndex = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID);
                int nameIndex = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DISPLAY_NAME);
                int sizeIndex = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.SIZE);
                int addedIndex = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DATE_ADDED);
                int mimeIndex = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.MIME_TYPE);
                int pathIndex = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.RELATIVE_PATH);
                int dataIndex = cursor.getColumnIndex(MediaStore.Files.FileColumns.DATA);

                while (cursor.moveToNext() && found.size() < MAX_DOCUMENTS) {
                    String name = valueOrFallback(cursor.getString(nameIndex), "");
                    String data = dataIndex >= 0 ? cursor.getString(dataIndex) : null;
                    if (name.isEmpty() && data != null) name = new File(data).getName();
                    if (!looksLikeDocument(name)) continue;

                    long id = cursor.getLong(idIndex);
                    String folder = valueOrFallback(cursor.getString(pathIndex), "").replaceAll("/$", "");

                    JSObject document = new JSObject();
                    document.put("id", String.valueOf(id));
                    document.put("name", name);
                    document.put("uri", ContentUris.withAppendedId(content, id).toString());
                    document.put("sizeBytes", cursor.getLong(sizeIndex));
                    document.put("addedAt", cursor.getLong(addedIndex) * 1000L);
                    document.put("mimeType", documentMime(name, cursor.getString(mimeIndex)));
                    document.put("folder", folder);
                    found.put(data != null ? key(data) : "id:" + volume + ":" + id, document);
                }
            } catch (Exception ignored) {
                // Nečitelný svazek se přeskočí, ostatní se tím nekazí.
            } finally {
                if (cursor != null) cursor.close();
            }
        }
    }

    /** Svazky, kde můžou dokumenty ležet - vnitřní paměť i karta. */
    private List<String> documentVolumes() {
        List<String> volumes = new ArrayList<>();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            try {
                volumes.addAll(MediaStore.getExternalVolumeNames(getContext()));
            } catch (Exception ignored) {
                // Starší nebo upravený systém: zůstane jen výchozí svazek.
            }
        }
        if (!volumes.contains("external")) volumes.add("external");
        return volumes;
    }

    /** Kořeny úložiště: vnitřní paměť a připojené karty. */
    private List<File> storageRoots() {
        List<File> roots = new ArrayList<>();
        File primary = Environment.getExternalStorageDirectory();
        if (primary != null && primary.canRead()) roots.add(primary);

        File[] mounted = new File("/storage").listFiles();
        if (mounted != null) {
            for (File candidate : mounted) {
                String name = candidate.getName();
                // "emulated" je vnitřní paměť (tu už máme), "self" je jen odkaz na ni.
                if ("emulated".equals(name) || "self".equals(name)) continue;
                if (candidate.isDirectory() && candidate.canRead()) roots.add(candidate);
            }
        }
        return roots;
    }

    /**
     * Projde složku a posbírá dokumenty, které v seznamu ještě nejsou.
     *
     * Do dat aplikací se nechodí - jsou to mezipaměti, ne knihovna. `Android/media`
     * je výjimka: tam ukládají přílohy komunikátory, takže tam knihy bývají.
     */
    private void collectFromStorage(File root, File directory, int depth, Map<String, JSObject> found) {
        if (depth > MAX_SCAN_DEPTH || found.size() >= MAX_DOCUMENTS) return;

        File[] entries = directory.listFiles();
        if (entries == null) return;

        for (File entry : entries) {
            if (found.size() >= MAX_DOCUMENTS) return;
            String name = entry.getName();

            if (entry.isDirectory()) {
                if (name.startsWith(".") || SKIPPED_DIRS.contains(name.toLowerCase(Locale.ROOT))) continue;
                collectFromStorage(root, entry, depth + 1, found);
                continue;
            }

            if (!looksLikeDocument(name) || entry.length() <= 0) continue;
            String key = key(entry.getAbsolutePath());
            if (found.containsKey(key)) continue;

            JSObject document = new JSObject();
            // Adresou je rovnou cesta k souboru: `PdfRenderer` i webová vrstva
            // si s ní poradí stejně jako s adresou z MediaStore.
            document.put("id", entry.getAbsolutePath());
            document.put("name", name);
            document.put("uri", entry.getAbsolutePath());
            document.put("sizeBytes", entry.length());
            document.put("addedAt", entry.lastModified());
            document.put("mimeType", documentMime(name, null));
            document.put("folder", relativeFolder(root, entry));
            found.put(key, document);
        }
    }

    /** Cesta ke složce tak, jak ji zná uživatel - `Download`, `Documents/knihy`. */
    private String relativeFolder(File root, File file) {
        File parent = file.getParentFile();
        if (parent == null) return "";
        String path = parent.getAbsolutePath();
        String base = root.getAbsolutePath();
        if (path.equals(base)) return "";
        if (path.startsWith(base + "/")) return path.substring(base.length() + 1);
        return path;
    }

    private static String key(String path) {
        return path.toLowerCase(Locale.ROOT);
    }

    private static boolean looksLikeDocument(String name) {
        if (name == null) return false;
        String lower = name.toLowerCase(Locale.ROOT);
        for (String extension : DOC_EXTENSIONS) {
            if (lower.endsWith(extension)) return true;
        }
        return false;
    }

    /** MIME typ z databáze bývá prázdný nebo obecný - pak rozhoduje přípona. */
    private static String documentMime(String name, String stored) {
        String lower = name == null ? "" : name.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".pdf")) return "application/pdf";
        if (lower.endsWith(".epub")) return "application/epub+zip";
        if (lower.endsWith(".md")) return "text/markdown";
        if (lower.endsWith(".txt")) return "text/plain";
        return stored == null || stored.isEmpty() ? "application/octet-stream" : stored;
    }

    /**
     * Obálka dokumentu - první stránka PDF jako obrázek.
     *
     * Kreslí ji systémový `PdfRenderer`, ne appka: soubor tak nemusí přes
     * webovou vrstvu, kde by se třináctimegová kniha musela celá natáhnout do
     * paměti jen kvůli náhledu.
     */
    @PluginMethod
    public void documentThumbnail(PluginCall call) {
        String uri = call.getString("uri");
        if (uri == null || uri.trim().isEmpty()) {
            call.reject("Chybí adresa dokumentu.", "MEDIA_BAD_REQUEST");
            return;
        }

        JSObject result = new JSObject();
        ParcelFileDescriptor descriptor = null;
        PdfRenderer renderer = null;
        PdfRenderer.Page page = null;
        Bitmap bitmap = null;

        try {
            // Dokumenty nalezené procházením úložiště nesou rovnou cestu k souboru,
            // ty z MediaStore adresu `content://`. Otevřít jde obojí.
            descriptor = uri.startsWith("/")
                ? ParcelFileDescriptor.open(new File(uri), ParcelFileDescriptor.MODE_READ_ONLY)
                : getContext().getContentResolver().openFileDescriptor(Uri.parse(uri), "r");
            if (descriptor == null) {
                result.put("thumbnail", (String) null);
                call.resolve(result);
                return;
            }
            renderer = new PdfRenderer(descriptor);
            if (renderer.getPageCount() < 1) {
                result.put("thumbnail", (String) null);
                call.resolve(result);
                return;
            }

            page = renderer.openPage(0);
            // Šířka dlaždice stačí; víc pixelů je jen práce navíc.
            int width = 320;
            int height = Math.max(1, Math.round(width * (page.getHeight() / (float) page.getWidth())));
            bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            bitmap.eraseColor(Color.WHITE);
            page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);

            try (ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                bitmap.compress(Bitmap.CompressFormat.JPEG, 75, out);
                result.put("thumbnail", "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
            }
            result.put("pages", renderer.getPageCount());
            call.resolve(result);
        } catch (Exception error) {
            // Zaheslované nebo poškozené PDF náhled nedá - dlaždice zůstane s ikonou.
            result.put("thumbnail", (String) null);
            call.resolve(result);
        } finally {
            if (bitmap != null) bitmap.recycle();
            try {
                if (page != null) page.close();
                if (renderer != null) renderer.close();
                if (descriptor != null) descriptor.close();
            } catch (Exception ignored) {
                // zavřít se nepovedlo - dál se s tím nic dělat nedá
            }
        }
    }

    /** Má appka přístup ke všem souborům? Bez něj PDF v telefonu nevidí. */
    @PluginMethod
    public void checkAllFilesAccess(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", hasAllFiles());
        call.resolve(result);
    }

    /** Otevře systémovou obrazovku, kde se přístup ke všem souborům povoluje. */
    @PluginMethod
    public void requestAllFilesAccess(PluginCall call) {
        try {
            Intent intent = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                ? new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, Uri.parse("package:" + getContext().getPackageName()))
                : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("Nastavení se nepodařilo otevřít.", "MEDIA_SETTINGS_FAILED", error);
        }
    }

    private boolean hasAllFiles() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return Environment.isExternalStorageManager();
        }
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.READ_EXTERNAL_STORAGE)
            == PackageManager.PERMISSION_GRANTED;
    }

    /**
     * Stáhne soubor z přímé adresy do telefonu.
     *
     * Obstará to systémový DownloadManager: umí pokračovat po výpadku sítě,
     * ukazuje průběh v liště a hotový soubor rovnou ohlásí MediaStore, takže
     * se objeví v knihovně bez dalšího zásahu.
     *
     * Vytahovat média ze stránek YouTube nebo Spotify tohle neumí a neřeší -
     * bere jen odkaz, který míří přímo na soubor.
     */
    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.trim().isEmpty()) {
            call.reject("Chybí adresa.", "DOWNLOAD_BAD_REQUEST");
            return;
        }

        Uri source;
        try {
            source = Uri.parse(url.trim());
            String scheme = source.getScheme();
            if (scheme == null || !(scheme.equals("http") || scheme.equals("https"))) {
                call.reject("Adresa musí začínat http:// nebo https://.", "DOWNLOAD_BAD_REQUEST");
                return;
            }
        } catch (Exception error) {
            call.reject("Adresa nedává smysl.", "DOWNLOAD_BAD_REQUEST", error);
            return;
        }

        String fileName = call.getString("fileName", "");
        if (fileName == null || fileName.trim().isEmpty()) {
            String last = source.getLastPathSegment();
            fileName = last != null && !last.trim().isEmpty() ? last : "stazeny-soubor";
        }
        // Video patří mezi filmy, zbytek mezi hudbu - podle toho ho pak najde
        // knihovna appky i galerie telefonu.
        boolean video = fileName.toLowerCase().endsWith(".mp4")
            || fileName.toLowerCase().endsWith(".mkv")
            || fileName.toLowerCase().endsWith(".webm");
        String folder = video ? Environment.DIRECTORY_MOVIES : Environment.DIRECTORY_MUSIC;

        try {
            DownloadManager.Request request = new DownloadManager.Request(source)
                .setTitle(fileName)
                .setDescription("P/_ayer")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalPublicDir(folder, fileName)
                .setAllowedOverMetered(true)
                .setAllowedOverRoaming(false);

            DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            if (manager == null) {
                call.reject("Stahování není v tomhle zařízení dostupné.", "DOWNLOAD_UNAVAILABLE");
                return;
            }

            JSObject result = new JSObject();
            result.put("id", String.valueOf(manager.enqueue(request)));
            result.put("fileName", fileName);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Stahování se nepodařilo spustit.", "DOWNLOAD_FAILED", error);
        }
    }

    /**
     * Náhled videa.
     *
     * MediaStore si miniatury drží sám, takže se nic negeneruje znovu -
     * jen se zmenší na velikost dlaždice a pošle jako data URI. Starší systémy
     * miniatury přes `loadThumbnail` neumí, tam je vytáhne přehrávač z prvního
     * snímku.
     */
    @PluginMethod
    public void videoThumbnail(PluginCall call) {
        String raw = call.getString("id");
        if (raw == null || raw.trim().isEmpty()) {
            call.reject("Chybí id videa.", "MEDIA_BAD_REQUEST");
            return;
        }

        Bitmap bitmap = null;
        try {
            long id = Long.parseLong(raw.trim());
            Uri uri = ContentUris.withAppendedId(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, id);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                bitmap = getContext().getContentResolver().loadThumbnail(uri, new Size(480, 270), null);
            } else {
                MediaMetadataRetriever retriever = new MediaMetadataRetriever();
                try {
                    retriever.setDataSource(getContext(), uri);
                    bitmap = retriever.getFrameAtTime(1_000_000);
                } finally {
                    retriever.release();
                }
            }
        } catch (Exception error) {
            bitmap = null;
        }

        JSObject result = new JSObject();
        if (bitmap == null) {
            result.put("thumbnail", (String) null);
            call.resolve(result);
            return;
        }

        try (ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            bitmap.compress(Bitmap.CompressFormat.JPEG, 70, out);
            result.put("thumbnail", "data:image/jpeg;base64," + Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP));
        } catch (Exception error) {
            result.put("thumbnail", (String) null);
        } finally {
            bitmap.recycle();
        }
        call.resolve(result);
    }

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(Uri.parse("package:" + getContext().getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        if (hasMediaPermission()) {
            call.resolve();
        } else {
            call.reject("Přístup k hudbě nebyl povolen.", "MEDIA_PERMISSION_DENIED");
        }
    }

    @PluginMethod
    public void listAudio(PluginCall call) {
        if (!hasMediaPermission()) {
            call.reject("Aplikace nemá přístup k hudbě.", "MEDIA_PERMISSION_DENIED");
            return;
        }

        ContentResolver resolver = getContext().getContentResolver();
        String[] projection = {
            MediaStore.Audio.Media._ID,
            MediaStore.Audio.Media.TITLE,
            MediaStore.Audio.Media.ARTIST,
            MediaStore.Audio.Media.ALBUM,
            MediaStore.Audio.Media.ALBUM_ID,
            MediaStore.Audio.Media.DURATION,
            MediaStore.Audio.Media.DATE_ADDED,
            MediaStore.Audio.Media.MIME_TYPE,
            MediaStore.Audio.Media.DISPLAY_NAME
        };
        JSONArray tracks = new JSONArray();
        Cursor cursor = null;

        try {
            cursor = resolver.query(
                MediaStore.Audio.Media.EXTERNAL_CONTENT_URI,
                projection,
                MediaStore.Audio.Media.IS_MUSIC + " != 0",
                null,
                MediaStore.Audio.Media.TITLE + " COLLATE NOCASE ASC"
            );

            if (cursor != null) {
                int idIndex = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media._ID);
                int titleIndex = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.TITLE);
                int artistIndex = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ARTIST);
                int albumIndex = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM);
                int albumIdIndex = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.ALBUM_ID);
                int durationIndex = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DURATION);
                int addedIndex = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DATE_ADDED);
                int mimeIndex = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.MIME_TYPE);
                int displayNameIndex = cursor.getColumnIndexOrThrow(MediaStore.Audio.Media.DISPLAY_NAME);

                while (cursor.moveToNext()) {
                    long id = cursor.getLong(idIndex);
                    String title = valueOrFallback(cursor.getString(titleIndex), cursor.getString(displayNameIndex), "Bez názvu");
                    String artist = valueOrFallback(cursor.getString(artistIndex), "Neznámý interpret");
                    String album = valueOrFallback(cursor.getString(albumIndex), "Hudba v zařízení");
                    long duration = cursor.getLong(durationIndex);
                    Uri contentUri = ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id);

                    // Obal alba. Když album obal nemá, adresa se prostě nenačte
                    // a webová vrstva místo něj ukáže svoji tichou notu.
                    long albumId = cursor.getLong(albumIdIndex);
                    String artwork = albumId > 0
                        ? ContentUris.withAppendedId(ALBUM_ART_URI, albumId).toString()
                        : null;

                    JSObject track = new JSObject();
                    track.put("id", String.valueOf(id));
                    track.put("title", title);
                    track.put("artist", artist);
                    track.put("album", album);
                    track.put("durationSeconds", Math.max(0, duration / 1000.0));
                    track.put("src", contentUri.toString());
                    track.put("artwork", artwork);
                    // MediaStore počítá datum v sekundách, JavaScript v milisekundách.
                    track.put("addedAt", cursor.getLong(addedIndex) * 1000L);
                    track.put("mimeType", valueOrFallback(cursor.getString(mimeIndex), "audio/*"));
                    tracks.put(track);
                }
            }
        } catch (SecurityException error) {
            call.reject("Aplikace nemá přístup k hudbě.", "MEDIA_PERMISSION_DENIED", error);
            return;
        } finally {
            if (cursor != null) cursor.close();
        }

        JSObject result = new JSObject();
        result.put("tracks", tracks);
        call.resolve(result);
    }

    /**
     * Smaže skladby ze zařízení, ne jen z knihovny appky.
     *
     * Soubor patří tomu, kdo ho stáhl, ne přehrávači - proto se od Androidu 11
     * ptá systém sám vlastním oknem (`createDeleteRequest`) a na Androidu 10
     * to samé zařídí `RecoverableSecurityException`. Starší systémy stačí
     * s právem na zápis. Odmítnuté potvrzení není chyba: vrátí se
     * `deleted: false` a appka nechá skladbu být.
     */
    @PluginMethod
    public void deleteAudio(PluginCall call) {
        List<Uri> uris = trackUris(call);
        if (uris == null) return;

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && !hasWritePermission()) {
            requestPermissionForAlias("write", call, "writePermissionCallback");
            return;
        }
        deleteTracks(call, uris);
    }

    @PermissionCallback
    private void writePermissionCallback(PluginCall call) {
        if (!hasWritePermission()) {
            call.reject("Mazání souborů nebylo povoleno.", "MEDIA_PERMISSION_DENIED");
            return;
        }
        List<Uri> uris = trackUris(call);
        if (uris != null) deleteTracks(call, uris);
    }

    /**
     * Adresy skladeb z volání. Bere `ids` i starší `id`: balík živé aktualizace
     * a APK bývají chvíli každý jinak starý a nemají se o sebe zakopnout.
     */
    private List<Uri> trackUris(PluginCall call) {
        List<String> raw;
        try {
            JSArray ids = call.getArray("ids");
            raw = ids != null ? ids.toList() : null;
        } catch (JSONException error) {
            raw = null;
        }
        if (raw == null) {
            String single = call.getString("id");
            raw = single != null ? Collections.singletonList(single) : Collections.<String>emptyList();
        }

        List<Uri> uris = new ArrayList<>();
        for (String value : raw) {
            if (value == null || value.trim().isEmpty()) continue;
            try {
                long id = Long.parseLong(value.trim());
                uris.add(ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id));
            } catch (NumberFormatException error) {
                // Ručně přidaný soubor v MediaStore není - přeskočí se.
            }
        }

        if (uris.isEmpty()) {
            call.reject("Chybí id skladby.", "MEDIA_BAD_REQUEST");
            return null;
        }
        return uris;
    }

    private boolean hasWritePermission() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.WRITE_EXTERNAL_STORAGE)
            == PackageManager.PERMISSION_GRANTED;
    }

    private void deleteTracks(PluginCall call, List<Uri> uris) {
        ContentResolver resolver = getContext().getContentResolver();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Android 11+: mazání obstará systém, appka jen ukáže jeho okno.
            // Všechny adresy naráz, ať se ptá jednou i u celého výběru.
            try {
                PendingIntent request = MediaStore.createDeleteRequest(resolver, uris);
                confirmWithUser(call, request.getIntentSender(), null);
            } catch (Exception error) {
                call.reject("Skladbu se nepodařilo smazat.", "MEDIA_DELETE_FAILED", error);
            }
            return;
        }

        try {
            int removed = 0;
            for (Uri uri : uris) removed += resolver.delete(uri, null, null);
            resolveDeleted(call, removed > 0);
        } catch (SecurityException error) {
            IntentSender sender = recoverableSender(error);
            if (sender == null) {
                call.reject("Skladbu se nepodařilo smazat.", "MEDIA_DELETE_FAILED", error);
                return;
            }
            // Android 10: po svolení se maže znovu, systém sám nic nesmaže.
            confirmWithUser(call, sender, uris);
        }
    }

    private IntentSender recoverableSender(SecurityException error) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null;
        if (!(error instanceof RecoverableSecurityException)) return null;
        return ((RecoverableSecurityException) error).getUserAction().getActionIntent().getIntentSender();
    }

    /**
     * Systémové okno s otázkou. `retryUri` je vyplněné tam, kde se po svolení
     * musí smazat ještě jednou (Android 10) - jinak systém smaže sám.
     */
    private void confirmWithUser(PluginCall call, IntentSender sender, List<Uri> retry) {
        if (!(getActivity() instanceof MainActivity)) {
            call.reject("Mazání není v tomhle prostředí dostupné.", "MEDIA_DELETE_FAILED");
            return;
        }
        MainActivity activity = (MainActivity) getActivity();
        activity.confirmWithSystem(
            sender,
            () -> {
                if (retry == null) {
                    resolveDeleted(call, true);
                    return;
                }
                try {
                    int removed = 0;
                    for (Uri uri : retry) removed += getContext().getContentResolver().delete(uri, null, null);
                    resolveDeleted(call, removed > 0);
                } catch (SecurityException error) {
                    call.reject("Skladbu se nepodařilo smazat.", "MEDIA_DELETE_FAILED", error);
                }
            },
            () -> resolveDeleted(call, false)
        );
    }

    private void resolveDeleted(PluginCall call, boolean deleted) {
        JSObject result = new JSObject();
        result.put("deleted", deleted);
        call.resolve(result);
    }

    /**
     * Videa v zařízení. Stejná cesta jako u hudby, jen jiná tabulka MediaStore
     * a jiné oprávnění - appka tak umí video přehrát, aniž by ho uživatel
     * musel hledat přes výběr souboru.
     */
    @PluginMethod
    public void listVideo(PluginCall call) {
        if (!hasVideoPermission()) {
            call.reject("Aplikace nemá přístup k videím.", "MEDIA_PERMISSION_DENIED");
            return;
        }

        ContentResolver resolver = getContext().getContentResolver();
        String[] projection = {
            MediaStore.Video.Media._ID,
            MediaStore.Video.Media.TITLE,
            MediaStore.Video.Media.DURATION,
            MediaStore.Video.Media.SIZE,
            MediaStore.Video.Media.DATE_ADDED,
            MediaStore.Video.Media.MIME_TYPE,
            MediaStore.Video.Media.DISPLAY_NAME
        };
        JSONArray videos = new JSONArray();
        Cursor cursor = null;

        try {
            cursor = resolver.query(
                MediaStore.Video.Media.EXTERNAL_CONTENT_URI,
                projection,
                null,
                null,
                MediaStore.Video.Media.DATE_ADDED + " DESC"
            );

            if (cursor != null) {
                int idIndex = cursor.getColumnIndexOrThrow(MediaStore.Video.Media._ID);
                int titleIndex = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.TITLE);
                int durationIndex = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.DURATION);
                int sizeIndex = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.SIZE);
                int addedIndex = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.DATE_ADDED);
                int mimeIndex = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.MIME_TYPE);
                int displayNameIndex = cursor.getColumnIndexOrThrow(MediaStore.Video.Media.DISPLAY_NAME);

                while (cursor.moveToNext()) {
                    long id = cursor.getLong(idIndex);
                    String title = valueOrFallback(
                        cursor.getString(titleIndex),
                        cursor.getString(displayNameIndex),
                        "Bez názvu"
                    );
                    Uri contentUri = ContentUris.withAppendedId(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, id);

                    JSObject video = new JSObject();
                    video.put("id", String.valueOf(id));
                    video.put("title", title);
                    video.put("fileName", valueOrFallback(cursor.getString(displayNameIndex), title));
                    video.put("durationSeconds", Math.max(0, cursor.getLong(durationIndex) / 1000.0));
                    video.put("sizeBytes", cursor.getLong(sizeIndex));
                    video.put("src", contentUri.toString());
                    // MediaStore počítá datum v sekundách, JavaScript v milisekundách.
                    video.put("addedAt", cursor.getLong(addedIndex) * 1000L);
                    video.put("mimeType", valueOrFallback(cursor.getString(mimeIndex), "video/*"));
                    videos.put(video);
                }
            }
        } catch (SecurityException error) {
            call.reject("Aplikace nemá přístup k videím.", "MEDIA_PERMISSION_DENIED", error);
            return;
        } finally {
            if (cursor != null) cursor.close();
        }

        JSObject result = new JSObject();
        result.put("videos", videos);
        call.resolve(result);
    }

    private String valueOrFallback(String value, String fallback) {
        if (value == null || value.trim().isEmpty() || "<unknown>".equalsIgnoreCase(value)) return fallback;
        return value;
    }

    private String valueOrFallback(String value, String preferred, String fallback) {
        if (value == null || value.trim().isEmpty() || "<unknown>".equalsIgnoreCase(value)) {
            return valueOrFallback(preferred, fallback);
        }
        return value;
    }
}
