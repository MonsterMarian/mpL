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
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
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
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
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
    @PluginMethod
    public void listDocuments(PluginCall call) {
        JSONArray documents = new JSONArray();

        if (!hasAllFiles()) {
            JSObject empty = new JSObject();
            empty.put("granted", false);
            empty.put("documents", documents);
            call.resolve(empty);
            return;
        }

        String[] projection = {
            MediaStore.Files.FileColumns._ID,
            MediaStore.Files.FileColumns.DISPLAY_NAME,
            MediaStore.Files.FileColumns.SIZE,
            MediaStore.Files.FileColumns.DATE_ADDED,
            MediaStore.Files.FileColumns.MIME_TYPE,
            MediaStore.Files.FileColumns.RELATIVE_PATH
        };
        String selection = MediaStore.Files.FileColumns.MIME_TYPE + " IN (?,?,?,?)";
        String[] args = { "application/pdf", "application/epub+zip", "text/plain", "text/markdown" };

        Cursor cursor = null;
        try {
            cursor = getContext()
                .getContentResolver()
                .query(
                    MediaStore.Files.getContentUri("external"),
                    projection,
                    selection,
                    args,
                    MediaStore.Files.FileColumns.DATE_ADDED + " DESC"
                );

            if (cursor != null) {
                int idIndex = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns._ID);
                int nameIndex = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DISPLAY_NAME);
                int sizeIndex = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.SIZE);
                int addedIndex = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.DATE_ADDED);
                int mimeIndex = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.MIME_TYPE);
                int pathIndex = cursor.getColumnIndexOrThrow(MediaStore.Files.FileColumns.RELATIVE_PATH);

                while (cursor.moveToNext()) {
                    long id = cursor.getLong(idIndex);
                    String name = valueOrFallback(cursor.getString(nameIndex), "Bez názvu");
                    String path = valueOrFallback(cursor.getString(pathIndex), "");

                    JSObject document = new JSObject();
                    document.put("id", String.valueOf(id));
                    document.put("name", name);
                    document.put("uri", ContentUris.withAppendedId(MediaStore.Files.getContentUri("external"), id).toString());
                    document.put("sizeBytes", cursor.getLong(sizeIndex));
                    document.put("addedAt", cursor.getLong(addedIndex) * 1000L);
                    document.put("mimeType", valueOrFallback(cursor.getString(mimeIndex), "application/pdf"));
                    // Složka bez koncového lomítka - v seznamu se pak čte líp.
                    document.put("folder", path.replaceAll("/$", ""));
                    documents.put(document);
                }
            }
        } catch (Exception error) {
            call.reject("Dokumenty se nepodařilo přečíst.", "MEDIA_READ_FAILED", error);
            return;
        } finally {
            if (cursor != null) cursor.close();
        }

        JSObject result = new JSObject();
        result.put("granted", true);
        result.put("documents", documents);
        call.resolve(result);
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

    /**
     * Otevře soubor v jiné aplikaci.
     *
     * WebView umí jen to, co má Android jako kodek pro web - MKV, AC3 a půlka
     * filmů mu nic neříká. Než aby appka tvrdila „nejde přehrát", pustí soubor
     * do přehrávače, který ho zvládne.
     */
    @PluginMethod
    public void openExternally(PluginCall call) {
        String uri = call.getString("uri");
        if (uri == null || uri.trim().isEmpty()) {
            call.reject("Chybí adresa souboru.", "MEDIA_BAD_REQUEST");
            return;
        }
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(Uri.parse(uri), call.getString("mimeType", "video/*"));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getContext().startActivity(Intent.createChooser(intent, "Otevřít v").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            call.resolve();
        } catch (Exception error) {
            call.reject("Soubor se nepodařilo otevřít.", "MEDIA_OPEN_FAILED", error);
        }
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
