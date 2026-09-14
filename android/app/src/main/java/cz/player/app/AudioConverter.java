package cz.player.app;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.media.MediaCodec;
import android.media.MediaExtractor;
import android.media.MediaFormat;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Log;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.util.ArrayList;
import java.util.List;

public class AudioConverter {

    private static final String TAG = "AudioConverter";

    /**
     * Checks if a file is already an MP3 by inspecting the header (ID3 or MPEG sync frame).
     */
    public static boolean isMp3File(File file) {
        if (file == null || !file.exists() || file.length() < 4) return false;
        try (FileInputStream in = new FileInputStream(file)) {
            byte[] header = new byte[4];
            int read = in.read(header);
            if (read < 3) return false;
            // ID3 header
            if (header[0] == 'I' && header[1] == 'D' && header[2] == '3') {
                return true;
            }
            // MPEG audio frame sync: 11 bits set to 1 (0xFF followed by 0xEx)
            if ((header[0] & 0xFF) == 0xFF && (header[1] & 0xE0) == 0xE0) {
                return true;
            }
        } catch (Exception ignored) {}
        return false;
    }

    /**
     * Decodes an audio file (e.g. M4A, WebM, AAC) to a 16-bit PCM WAV file using MediaCodec.
     */
    public static void decodeToWav(File inputFile, File outputWavFile) throws IOException {
        MediaExtractor extractor = new MediaExtractor();
        extractor.setDataSource(inputFile.getAbsolutePath());

        int audioTrackIndex = -1;
        MediaFormat format = null;
        for (int i = 0; i < extractor.getTrackCount(); i++) {
            MediaFormat f = extractor.getTrackFormat(i);
            String mime = f.getString(MediaFormat.KEY_MIME);
            if (mime != null && mime.startsWith("audio/")) {
                audioTrackIndex = i;
                format = f;
                break;
            }
        }

        if (audioTrackIndex < 0 || format == null) {
            extractor.release();
            throw new IOException("Ve staženém souboru nebyla nalezena zvuková stopa.");
        }

        extractor.selectTrack(audioTrackIndex);
        String mime = format.getString(MediaFormat.KEY_MIME);
        if (mime == null) {
            extractor.release();
            throw new IOException("Neznámý audio formát.");
        }

        MediaCodec codec = MediaCodec.createDecoderByType(mime);
        codec.configure(format, null, null, 0);
        codec.start();

        int sampleRate = format.containsKey(MediaFormat.KEY_SAMPLE_RATE)
            ? format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
            : 44100;
        int channelCount = format.containsKey(MediaFormat.KEY_CHANNEL_COUNT)
            ? format.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
            : 2;

        try (FileOutputStream fos = new FileOutputStream(outputWavFile)) {
            // Write 44-byte WAV header placeholder
            writeWavHeader(fos, channelCount, sampleRate, 0);

            MediaCodec.BufferInfo bufferInfo = new MediaCodec.BufferInfo();
            boolean isExtractorEOS = false;
            boolean isDecoderEOS = false;
            final long TIMEOUT_US = 10000;
            long totalPcmBytes = 0;

            while (!isDecoderEOS) {
                if (!isExtractorEOS) {
                    int inIndex = codec.dequeueInputBuffer(TIMEOUT_US);
                    if (inIndex >= 0) {
                        ByteBuffer inBuffer = codec.getInputBuffer(inIndex);
                        if (inBuffer != null) {
                            inBuffer.clear();
                            int sampleSize = extractor.readSampleData(inBuffer, 0);
                            if (sampleSize < 0) {
                                codec.queueInputBuffer(inIndex, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM);
                                isExtractorEOS = true;
                            } else {
                                codec.queueInputBuffer(inIndex, 0, sampleSize, extractor.getSampleTime(), 0);
                                extractor.advance();
                            }
                        }
                    }
                }

                int outIndex = codec.dequeueOutputBuffer(bufferInfo, TIMEOUT_US);
                if (outIndex >= 0) {
                    ByteBuffer outBuffer = codec.getOutputBuffer(outIndex);
                    if (outBuffer != null && bufferInfo.size > 0) {
                        outBuffer.position(bufferInfo.offset);
                        outBuffer.limit(bufferInfo.offset + bufferInfo.size);
                        byte[] chunk = new byte[bufferInfo.size];
                        outBuffer.get(chunk);
                        fos.write(chunk);
                        totalPcmBytes += bufferInfo.size;
                    }
                    codec.releaseOutputBuffer(outIndex, false);
                    if ((bufferInfo.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                        isDecoderEOS = true;
                    }
                } else if (outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    MediaFormat newFormat = codec.getOutputFormat();
                    if (newFormat.containsKey(MediaFormat.KEY_SAMPLE_RATE)) {
                        sampleRate = newFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE);
                    }
                    if (newFormat.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) {
                        channelCount = newFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT);
                    }
                }
            }

            fos.flush();
            updateWavHeader(outputWavFile, channelCount, sampleRate, totalPcmBytes);
        } finally {
            try {
                codec.stop();
            } catch (Exception ignored) {}
            try {
                codec.release();
            } catch (Exception ignored) {}
            try {
                extractor.release();
            } catch (Exception ignored) {}
        }
    }

    private static void writeWavHeader(OutputStream out, int channels, int sampleRate, long dataSize) throws IOException {
        long totalDataLen = dataSize + 36;
        int bitsPerSample = 16;
        long byteRate = (long) sampleRate * channels * bitsPerSample / 8;
        int blockAlign = channels * bitsPerSample / 8;

        byte[] header = new byte[44];
        header[0] = 'R'; header[1] = 'I'; header[2] = 'F'; header[3] = 'F';
        header[4] = (byte) (totalDataLen & 0xff);
        header[5] = (byte) ((totalDataLen >> 8) & 0xff);
        header[6] = (byte) ((totalDataLen >> 16) & 0xff);
        header[7] = (byte) ((totalDataLen >> 24) & 0xff);
        header[8] = 'W'; header[9] = 'A'; header[10] = 'V'; header[11] = 'E';
        header[12] = 'f'; header[13] = 'm'; header[14] = 't'; header[15] = ' ';
        header[16] = 16; header[17] = 0; header[18] = 0; header[19] = 0;
        header[20] = 1; header[21] = 0;
        header[22] = (byte) channels; header[23] = 0;
        header[24] = (byte) (sampleRate & 0xff);
        header[25] = (byte) ((sampleRate >> 8) & 0xff);
        header[26] = (byte) ((sampleRate >> 16) & 0xff);
        header[27] = (byte) ((sampleRate >> 24) & 0xff);
        header[28] = (byte) (byteRate & 0xff);
        header[29] = (byte) ((byteRate >> 8) & 0xff);
        header[30] = (byte) ((byteRate >> 16) & 0xff);
        header[31] = (byte) ((byteRate >> 24) & 0xff);
        header[32] = (byte) blockAlign; header[33] = 0;
        header[34] = (byte) bitsPerSample; header[35] = 0;
        header[36] = 'd'; header[37] = 'a'; header[38] = 't'; header[39] = 'a';
        header[40] = (byte) (dataSize & 0xff);
        header[41] = (byte) ((dataSize >> 8) & 0xff);
        header[42] = (byte) ((dataSize >> 16) & 0xff);
        header[43] = (byte) ((dataSize >> 24) & 0xff);

        out.write(header, 0, 44);
    }

    private static void updateWavHeader(File wavFile, int channels, int sampleRate, long dataSize) throws IOException {
        try (RandomAccessFile raf = new RandomAccessFile(wavFile, "rw")) {
            raf.seek(0);
            long totalDataLen = dataSize + 36;
            int bitsPerSample = 16;
            long byteRate = (long) sampleRate * channels * bitsPerSample / 8;
            int blockAlign = channels * bitsPerSample / 8;

            byte[] header = new byte[44];
            header[0] = 'R'; header[1] = 'I'; header[2] = 'F'; header[3] = 'F';
            header[4] = (byte) (totalDataLen & 0xff);
            header[5] = (byte) ((totalDataLen >> 8) & 0xff);
            header[6] = (byte) ((totalDataLen >> 16) & 0xff);
            header[7] = (byte) ((totalDataLen >> 24) & 0xff);
            header[8] = 'W'; header[9] = 'A'; header[10] = 'V'; header[11] = 'E';
            header[12] = 'f'; header[13] = 'm'; header[14] = 't'; header[15] = ' ';
            header[16] = 16; header[17] = 0; header[18] = 0; header[19] = 0;
            header[20] = 1; header[21] = 0;
            header[22] = (byte) channels; header[23] = 0;
            header[24] = (byte) (sampleRate & 0xff);
            header[25] = (byte) ((sampleRate >> 8) & 0xff);
            header[26] = (byte) ((sampleRate >> 16) & 0xff);
            header[27] = (byte) ((sampleRate >> 24) & 0xff);
            header[28] = (byte) (byteRate & 0xff);
            header[29] = (byte) ((byteRate >> 8) & 0xff);
            header[30] = (byte) ((byteRate >> 16) & 0xff);
            header[31] = (byte) ((byteRate >> 24) & 0xff);
            header[32] = (byte) blockAlign; header[33] = 0;
            header[34] = (byte) bitsPerSample; header[35] = 0;
            header[36] = 'd'; header[37] = 'a'; header[38] = 't'; header[39] = 'a';
            header[40] = (byte) (dataSize & 0xff);
            header[41] = (byte) ((dataSize >> 8) & 0xff);
            header[42] = (byte) ((dataSize >> 16) & 0xff);
            header[43] = (byte) ((dataSize >> 24) & 0xff);

            raf.write(header, 0, 44);
        }
    }

    /**
     * Converts a WAV file to an MP3 file using Jump3r (LAME pure Java).
     */
    public static void wavToMp3(File wavFile, File mp3File, String title, String artist) throws Exception {
        List<String> args = new ArrayList<>();
        args.add("-b");
        args.add("192");
        args.add("-h");
        if (title != null && !title.trim().isEmpty()) {
            args.add("--tt");
            args.add(title.trim());
        }
        if (artist != null && !artist.trim().isEmpty()) {
            args.add("--ta");
            args.add(artist.trim());
        }
        args.add(wavFile.getAbsolutePath());
        args.add(mp3File.getAbsolutePath());

        de.sciss.jump3r.Main main = new de.sciss.jump3r.Main();
        int res = main.run(args.toArray(new String[0]));
        if (res != 0 || !mp3File.exists() || mp3File.length() == 0) {
            throw new IOException("Převod do MP3 selhal (kód " + res + ")");
        }
    }

    /**
     * Saves an MP3 file into MediaStore (Music directory).
     */
    public static Uri saveMp3ToMediaStore(Context context, File mp3File, String fileName, String title, String artist) throws IOException {
        ContentResolver resolver = context.getContentResolver();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Audio.Media.DISPLAY_NAME, fileName);
            values.put(MediaStore.Audio.Media.TITLE, title != null && !title.isEmpty() ? title : fileName);
            if (artist != null && !artist.isEmpty()) {
                values.put(MediaStore.Audio.Media.ARTIST, artist);
            }
            values.put(MediaStore.Audio.Media.MIME_TYPE, "audio/mpeg");
            values.put(MediaStore.Audio.Media.RELATIVE_PATH, Environment.DIRECTORY_MUSIC);
            values.put(MediaStore.Audio.Media.IS_MUSIC, 1);
            values.put(MediaStore.Audio.Media.IS_PENDING, 1);

            Uri uri = resolver.insert(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, values);
            if (uri == null) {
                throw new IOException("Nepodařilo se vytvořit záznam v MediaStore.");
            }

            try (OutputStream out = resolver.openOutputStream(uri);
                 InputStream in = new FileInputStream(mp3File)) {
                if (out == null) throw new IOException("Nelze zapisovat do MediaStore URI.");
                byte[] buf = new byte[16384];
                int len;
                while ((len = in.read(buf)) > 0) {
                    out.write(buf, 0, len);
                }
                out.flush();
            }

            values.clear();
            values.put(MediaStore.Audio.Media.IS_PENDING, 0);
            resolver.update(uri, values, null, null);
            return uri;
        } else {
            File musicDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_MUSIC);
            if (!musicDir.exists()) {
                musicDir.mkdirs();
            }
            File dest = new File(musicDir, fileName);
            int count = 1;
            String base = fileName.endsWith(".mp3") ? fileName.substring(0, fileName.length() - 4) : fileName;
            while (dest.exists()) {
                dest = new File(musicDir, base + " (" + count++ + ").mp3");
            }

            try (OutputStream out = new FileOutputStream(dest);
                 InputStream in = new FileInputStream(mp3File)) {
                byte[] buf = new byte[16384];
                int len;
                while ((len = in.read(buf)) > 0) {
                    out.write(buf, 0, len);
                }
                out.flush();
            }
            android.media.MediaScannerConnection.scanFile(
                context,
                new String[]{ dest.getAbsolutePath() },
                new String[]{ "audio/mpeg" },
                null
            );
            return Uri.fromFile(dest);
        }
    }
}
