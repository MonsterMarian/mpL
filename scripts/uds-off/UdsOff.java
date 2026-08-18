import java.lang.instrument.Instrumentation;
import java.lang.reflect.Field;
import java.util.Map;
import java.util.Set;

/**
 * Vypne v JVM podporu unixových soketů.
 *
 * Na tomhle stroji je AF_UNIX rozbitý (bind projde, connect vrátí "Invalid
 * argument"), a protože si přes něj JDK dělá každý Selector.open(), nejede
 * Gradle vůbec. Na TCP loopback, který funguje, JDK sám neuhne - přepínač
 * pro to není. Tenhle agent proto přepíše příznak, podle kterého se JDK
 * rozhoduje, a všechno se vrátí na TCP cestu.
 */
public final class UdsOff {
    public static void premain(String args, Instrumentation inst) {
        try {
            Module base = Object.class.getModule();
            inst.redefineModule(
                base,
                Set.of(),
                Map.of(),
                Map.of("sun.nio.ch", Set.of(UdsOff.class.getModule())),
                Set.of(),
                Map.of()
            );

            Class<?> uds = Class.forName("sun.nio.ch.UnixDomainSockets");
            Field supported = uds.getDeclaredField("supported");

            Field theUnsafe = Class.forName("sun.misc.Unsafe").getDeclaredField("theUnsafe");
            theUnsafe.setAccessible(true);
            Object unsafe = theUnsafe.get(null);
            Class<?> unsafeClass = unsafe.getClass();

            Object fieldBase = unsafeClass.getMethod("staticFieldBase", Field.class).invoke(unsafe, supported);
            long offset = (long) unsafeClass.getMethod("staticFieldOffset", Field.class).invoke(unsafe, supported);
            unsafeClass
                .getMethod("putBoolean", Object.class, long.class, boolean.class)
                .invoke(unsafe, fieldBase, offset, false);
        } catch (Throwable error) {
            System.err.println("[uds-off] nepovedlo se: " + error);
        }
    }
}
