package cz.player.app;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.Intent;
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
import org.json.JSONArray;

@CapacitorPlugin(
    name = "MediaLibrary",
    permissions = {
        @Permission(alias = "media", strings = { Manifest.permission.READ_MEDIA_AUDIO }),
        @Permission(alias = "storage", strings = { Manifest.permission.READ_EXTERNAL_STORAGE })
    }
)
public class MediaLibraryPlugin extends Plugin {

    /** Obaly alb má MediaStore pod vlastní adresou, ne u samotné skladby. */
    private static final Uri ALBUM_ART_URI = Uri.parse("content://media/external/audio/albumart");

    private String permissionAlias() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ? "media" : "storage";
    }

    private boolean hasMediaPermission() {
        String permission = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            ? Manifest.permission.READ_MEDIA_AUDIO
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
