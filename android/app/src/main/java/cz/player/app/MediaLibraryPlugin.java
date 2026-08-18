package cz.player.app;

import android.Manifest;
import android.app.PendingIntent;
import android.app.RecoverableSecurityException;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Intent;
import android.content.IntentSender;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.provider.Settings;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.Collections;
import org.json.JSONArray;

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
     * Smaže skladbu ze zařízení, ne jen z knihovny appky.
     *
     * Soubor patří tomu, kdo ho stáhl, ne přehrávači - proto se od Androidu 11
     * ptá systém sám vlastním oknem (`createDeleteRequest`) a na Androidu 10
     * to samé zařídí `RecoverableSecurityException`. Starší systémy stačí
     * s právem na zápis. Odmítnuté potvrzení není chyba: vrátí se
     * `deleted: false` a appka nechá skladbu být.
     */
    @PluginMethod
    public void deleteAudio(PluginCall call) {
        Long id = trackId(call);
        if (id == null) return;

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && !hasWritePermission()) {
            requestPermissionForAlias("write", call, "writePermissionCallback");
            return;
        }
        deleteTrack(call, id);
    }

    @PermissionCallback
    private void writePermissionCallback(PluginCall call) {
        if (!hasWritePermission()) {
            call.reject("Mazání souborů nebylo povoleno.", "MEDIA_PERMISSION_DENIED");
            return;
        }
        Long id = trackId(call);
        if (id != null) deleteTrack(call, id);
    }

    /** Id skladby z volání. Když chybí nebo je nesmyslné, volání se rovnou odmítne. */
    private Long trackId(PluginCall call) {
        String raw = call.getString("id");
        if (raw == null || raw.trim().isEmpty()) {
            call.reject("Chybí id skladby.", "MEDIA_BAD_REQUEST");
            return null;
        }
        try {
            return Long.parseLong(raw.trim());
        } catch (NumberFormatException error) {
            call.reject("Skladba není ze zařízení.", "MEDIA_BAD_REQUEST");
            return null;
        }
    }

    private boolean hasWritePermission() {
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.WRITE_EXTERNAL_STORAGE)
            == PackageManager.PERMISSION_GRANTED;
    }

    private void deleteTrack(PluginCall call, long id) {
        Uri uri = ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, id);
        ContentResolver resolver = getContext().getContentResolver();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Android 11+: mazání obstará systém, appka jen ukáže jeho okno.
            try {
                PendingIntent request = MediaStore.createDeleteRequest(resolver, Collections.singletonList(uri));
                confirmWithUser(call, request.getIntentSender(), null);
            } catch (Exception error) {
                call.reject("Skladbu se nepodařilo smazat.", "MEDIA_DELETE_FAILED", error);
            }
            return;
        }

        try {
            resolveDeleted(call, resolver.delete(uri, null, null) > 0);
        } catch (SecurityException error) {
            IntentSender sender = recoverableSender(error);
            if (sender == null) {
                call.reject("Skladbu se nepodařilo smazat.", "MEDIA_DELETE_FAILED", error);
                return;
            }
            // Android 10: po svolení se maže znovu, systém sám nic nesmaže.
            confirmWithUser(call, sender, uri);
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
    private void confirmWithUser(PluginCall call, IntentSender sender, Uri retryUri) {
        if (!(getActivity() instanceof MainActivity)) {
            call.reject("Mazání není v tomhle prostředí dostupné.", "MEDIA_DELETE_FAILED");
            return;
        }
        MainActivity activity = (MainActivity) getActivity();
        activity.confirmWithSystem(
            sender,
            () -> {
                if (retryUri == null) {
                    resolveDeleted(call, true);
                    return;
                }
                try {
                    resolveDeleted(call, getContext().getContentResolver().delete(retryUri, null, null) > 0);
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
