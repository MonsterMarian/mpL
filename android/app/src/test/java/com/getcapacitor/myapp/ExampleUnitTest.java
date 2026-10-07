package com.getcapacitor.myapp;

import static org.junit.Assert.*;

import org.junit.Test;

/**
 * Example local unit test, which will execute on the development machine (host).
 *
 * @see <a href="http://d.android.com/tools/testing">Testing documentation</a>
 */
public class ExampleUnitTest {

    @Test
    public void addition_isCorrect() throws Exception {
        assertEquals(4, 2 + 2);
    }

    @Test
    public void youtubeUrlNormalization_isCorrect() {
        assertEquals(
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            cz.player.app.StreamPlugin.normalizeYouTubeUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        );
        assertEquals(
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            cz.player.app.StreamPlugin.normalizeYouTubeUrl("https://youtu.be/dQw4w9WgXcQ?si=abcdef12345")
        );
        assertEquals(
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            cz.player.app.StreamPlugin.normalizeYouTubeUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ")
        );
        assertEquals(
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            cz.player.app.StreamPlugin.normalizeYouTubeUrl("https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123456789")
        );
    }
}
