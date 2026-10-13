package cz.player.app;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * Značky přímo v souboru M4A: název, interpret, album a obrázek.
 *
 * Obrázek dřív žil jen ve složce appky - přeinstalace ho smazala a jiný
 * přehrávač ho neviděl vůbec. V souboru přežije obojí a MediaStore si z něj
 * sám udělá obal alba. Album je název skladby (jako u singlu); se společným
 * albem by všechna stažená videa sdílela jeden obal.
 *
 * Píše se klasická značka iTunes: moov/udta/meta/ilst s položkami ©nam, ©ART,
 * ©alb, aART a covr. Čistá Java bez Androidu, ať jde vyzkoušet i na počítači.
 *
 * Když moov roste a leží před daty, posunou se data - u běžného MP4 se proto
 * přepočítají odkazy stco/co64. YouTube posílá fragmentované MP4, jehož
 * fragmenty míří relativně ke svému začátku (default-base-is-moof), tam se nic
 * přepočítávat nemusí. Fragment s absolutní adresou (base-data-offset) by se
 * posunem rozbil - takový soubor se radši nechá být.
 */
final class Mp4Tags {

    private Mp4Tags() {}

    /** Typ hodnoty v boxu „data": text v UTF-8 a obrázek JPEG. */
    private static final int TYPE_UTF8 = 1;
    private static final int TYPE_JPEG = 13;

    /**
     * Zapíše značky do souboru (přes dočasnou kopii, originál se nahradí až
     * po úspěchu). Vrátí false, když soubor není MP4, kterému to jde bezpečně
     * zapsat - pak zůstane, jak byl.
     */
    static boolean write(File file, String title, String artist, String album, byte[] jpeg) throws IOException {
        List<long[]> boxes = topLevel(file);
        long[] moov = null;
        long firstData = -1;
        for (long[] box : boxes) {
            String type = typeName((int) box[2]);
            if ("moov".equals(type) && moov == null) moov = box;
            if (("mdat".equals(type) || "moof".equals(type)) && firstData < 0) firstData = box[0];
        }
        if (moov == null || moov[1] > Integer.MAX_VALUE) return false;
        if (hasAbsoluteFragments(file, boxes)) return false;

        byte[] oldMoov = read(file, moov[0], (int) moov[1]);
        byte[] udta = udta(title, artist, album, jpeg);
        byte[] newMoov = rebuildMoov(oldMoov, udta);
        long delta = newMoov.length - oldMoov.length;
        // Data za moov se posunou - u běžného MP4 na ně ukazuje stco/co64.
        if (firstData > moov[0] && delta != 0) shiftChunkOffsets(newMoov, 8, newMoov.length, delta);

        File temp = new File(file.getPath() + ".tags");
        try (RandomAccessFile in = new RandomAccessFile(file, "r");
             OutputStream out = new FileOutputStream(temp)) {
            copy(in, 0, moov[0], out);
            out.write(newMoov);
            copy(in, moov[0] + moov[1], in.length() - (moov[0] + moov[1]), out);
        }
        if (!file.delete() || !temp.renameTo(file)) {
            temp.delete();
            throw new IOException("Soubor se značkami se nepodařilo uložit.");
        }
        return true;
    }

    // --- čtení -----------------------------------------------------------

    /** Boxy nejvyšší úrovně: {začátek, velikost, typ}. */
    private static List<long[]> topLevel(File file) throws IOException {
        List<long[]> out = new ArrayList<>();
        try (RandomAccessFile in = new RandomAccessFile(file, "r")) {
            long length = in.length();
            long at = 0;
            while (at + 8 <= length) {
                in.seek(at);
                long size = in.readInt() & 0xFFFFFFFFL;
                int type = in.readInt();
                if (size == 1) size = in.readLong();
                else if (size == 0) size = length - at;
                if (size < 8 || at + size > length) return out;
                out.add(new long[] { at, size, type });
                at += size;
            }
        }
        return out;
    }

    /** Má některý fragment absolutní adresu dat? Ta by se posunem rozbila. */
    private static boolean hasAbsoluteFragments(File file, List<long[]> boxes) throws IOException {
        for (long[] box : boxes) {
            if (!"moof".equals(typeName((int) box[2])) || box[1] > 1 << 20) continue;
            byte[] moof = read(file, box[0], (int) box[1]);
            if (findAbsoluteTfhd(moof, 8, moof.length)) return true;
        }
        return false;
    }

    private static boolean findAbsoluteTfhd(byte[] buf, int start, int end) {
        int at = start;
        while (at + 8 <= end) {
            int size = readInt(buf, at);
            if (size < 8 || at + size > end) return false;
            String type = typeName(readInt(buf, at + 4));
            if ("traf".equals(type) && findAbsoluteTfhd(buf, at + 8, at + size)) return true;
            if ("tfhd".equals(type) && (readInt(buf, at + 8) & 0x1) != 0) return true;
            at += size;
        }
        return false;
    }

    // --- stavba ----------------------------------------------------------

    /** moov bez staré udta, s novou udta na konci. */
    private static byte[] rebuildMoov(byte[] moov, byte[] udta) throws IOException {
        ByteArrayOutputStream body = new ByteArrayOutputStream(moov.length + udta.length);
        int at = 8;
        while (at + 8 <= moov.length) {
            int size = readInt(moov, at);
            if (size < 8 || at + size > moov.length) throw new IOException("Poškozený moov.");
            if (!"udta".equals(typeName(readInt(moov, at + 4)))) body.write(moov, at, size);
            at += size;
        }
        body.write(udta);
        return box("moov", body.toByteArray());
    }

    private static byte[] udta(String title, String artist, String album, byte[] jpeg) throws IOException {
        ByteArrayOutputStream items = new ByteArrayOutputStream();
        text(items, "©nam", title);
        text(items, "©ART", artist);
        text(items, "©alb", album);
        text(items, "aART", artist);
        if (jpeg != null && jpeg.length > 0) items.write(box("covr", data(TYPE_JPEG, jpeg)));

        // hdlr metadat iTunes: handler „mdir", výrobce „appl", prázdné jméno.
        ByteArrayOutputStream hdlr = new ByteArrayOutputStream();
        hdlr.write(new byte[8]); // verze + příznaky, pre_defined
        hdlr.write("mdir".getBytes(StandardCharsets.ISO_8859_1));
        hdlr.write("appl".getBytes(StandardCharsets.ISO_8859_1));
        hdlr.write(new byte[8]);
        hdlr.write(0);

        ByteArrayOutputStream meta = new ByteArrayOutputStream();
        meta.write(new byte[4]); // meta je „full box": verze + příznaky
        meta.write(box("hdlr", hdlr.toByteArray()));
        meta.write(box("ilst", items.toByteArray()));
        return box("udta", box("meta", meta.toByteArray()));
    }

    private static void text(ByteArrayOutputStream items, String type, String value) throws IOException {
        if (value == null || value.trim().isEmpty()) return;
        items.write(box(type, data(TYPE_UTF8, value.trim().getBytes(StandardCharsets.UTF_8))));
    }

    private static byte[] data(int kind, byte[] payload) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(payload.length + 8);
        writeInt(out, kind);
        writeInt(out, 0); // jazyk / země
        out.write(payload);
        return box("data", out.toByteArray());
    }

    private static byte[] box(String type, byte[] body) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream(body.length + 8);
        writeInt(out, body.length + 8);
        // ISO-8859-1, ať se „©" zapíše jako jediný bajt 0xA9.
        out.write(type.getBytes(StandardCharsets.ISO_8859_1));
        out.write(body);
        return out.toByteArray();
    }

    /** Přičte posun ke všem odkazům na data (stco 32bit, co64 64bit). */
    private static void shiftChunkOffsets(byte[] buf, int start, int end, long delta) throws IOException {
        int at = start;
        while (at + 8 <= end) {
            int size = readInt(buf, at);
            if (size < 8 || at + size > end) return;
            String type = typeName(readInt(buf, at + 4));
            switch (type) {
                case "trak":
                case "mdia":
                case "minf":
                case "stbl":
                    shiftChunkOffsets(buf, at + 8, at + size, delta);
                    break;
                case "stco": {
                    int count = readInt(buf, at + 12);
                    for (int i = 0; i < count; i++) {
                        int pos = at + 16 + i * 4;
                        long value = (readInt(buf, pos) & 0xFFFFFFFFL) + delta;
                        if (value > 0xFFFFFFFFL) throw new IOException("Posun přetekl stco.");
                        putInt(buf, pos, (int) value);
                    }
                    break;
                }
                case "co64": {
                    int count = readInt(buf, at + 12);
                    for (int i = 0; i < count; i++) {
                        int pos = at + 16 + i * 8;
                        long value = ((long) readInt(buf, pos) << 32 | (readInt(buf, pos + 4) & 0xFFFFFFFFL)) + delta;
                        putInt(buf, pos, (int) (value >>> 32));
                        putInt(buf, pos + 4, (int) value);
                    }
                    break;
                }
                default:
                    break;
            }
            at += size;
        }
    }

    // --- bajty -----------------------------------------------------------

    private static byte[] read(File file, long offset, int length) throws IOException {
        byte[] out = new byte[length];
        try (RandomAccessFile in = new RandomAccessFile(file, "r")) {
            in.seek(offset);
            in.readFully(out);
        }
        return out;
    }

    private static void copy(RandomAccessFile in, long offset, long length, OutputStream out) throws IOException {
        in.seek(offset);
        byte[] buffer = new byte[65536];
        long left = length;
        while (left > 0) {
            int read = in.read(buffer, 0, (int) Math.min(buffer.length, left));
            if (read < 0) throw new IOException("Soubor skončil předčasně.");
            out.write(buffer, 0, read);
            left -= read;
        }
    }

    private static int readInt(byte[] buf, int at) {
        return (buf[at] & 0xFF) << 24 | (buf[at + 1] & 0xFF) << 16 | (buf[at + 2] & 0xFF) << 8 | (buf[at + 3] & 0xFF);
    }

    private static void putInt(byte[] buf, int at, int value) {
        buf[at] = (byte) (value >>> 24);
        buf[at + 1] = (byte) (value >>> 16);
        buf[at + 2] = (byte) (value >>> 8);
        buf[at + 3] = (byte) value;
    }

    private static void writeInt(OutputStream out, int value) throws IOException {
        out.write(value >>> 24);
        out.write(value >>> 16);
        out.write(value >>> 8);
        out.write(value);
    }

    private static String typeName(int type) {
        return new String(
            new byte[] { (byte) (type >>> 24), (byte) (type >>> 16), (byte) (type >>> 8), (byte) type },
            StandardCharsets.ISO_8859_1
        );
    }

    /** Jen pro test z příkazové řádky: java Mp4Tags soubor.m4a obal.jpg */
    public static void main(String[] args) throws IOException {
        byte[] jpeg;
        try (InputStream in = new FileInputStream(args[1])) {
            jpeg = in.readAllBytes();
        }
        System.out.println(write(new File(args[0]), "Testovací název", "Testovací interpret", "Testovací název", jpeg));
    }
}
