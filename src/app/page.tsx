"use client";

import * as React from "react";
import { Play, Pause, FileAudio, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SettingsDialog } from "@/components/settings-dialog";

export default function HomePage() {
  // Audio Player State
  const [audioSrc, setAudioSrc] = React.useState<string | null>(null);
  const [isPlayingAudio, setIsPlayingAudio] = React.useState(false);
  const audioRef = React.useRef<HTMLAudioElement | null>(null);

  // PDF Reader State
  const [pdfText, setPdfText] = React.useState<string[]>([]);
  const [isReadingPdf, setIsReadingPdf] = React.useState(false);
  const [currentPdfPage, setCurrentPdfPage] = React.useState(0);
  
  // Ref pro kontrolu, jestli máme přerušit čtení
  const readingRef = React.useRef(false);

  React.useEffect(() => {
    // Auto-load audio from settings
    const savedUrl = localStorage.getItem("microwins:audio_url");
    const autoPlay = localStorage.getItem("microwins:audio_autoplay") === "true";
    if (savedUrl) {
      setAudioSrc(savedUrl);
      if (autoPlay) {
        // Zpoždění pro inicializaci komponenty
        setTimeout(() => {
          if (audioRef.current) {
            audioRef.current.play().then(() => setIsPlayingAudio(true)).catch(e => console.error("Auto-play selhal:", e));
          }
        }, 500);
      }
    }
  }, []);

  const handleAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setAudioSrc(url);
      setIsPlayingAudio(false);
    }
  };

  const toggleAudio = () => {
    if (!audioRef.current) return;
    if (isPlayingAudio) {
      audioRef.current.pause();
      setIsPlayingAudio(false);
    } else {
      audioRef.current.play();
      setIsPlayingAudio(true);
    }
  };

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
        
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        
        const pagesText: string[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          const strings = content.items.map((item: any) => item.str);
          pagesText.push(strings.join(" "));
        }
        
        setPdfText(pagesText);
        setCurrentPdfPage(0);
        setIsReadingPdf(false);
        readingRef.current = false;
      } catch (err) {
        console.error("Chyba při čtení PDF:", err);
        alert("Nepodařilo se přečíst PDF soubor.");
      }
    }
  };

  const readPdfPageByPage = async (startIndex: number) => {
    const { TextToSpeech } = await import('@capacitor-community/text-to-speech');
    for (let i = startIndex; i < pdfText.length; i++) {
      if (!readingRef.current) break;
      setCurrentPdfPage(i);
      
      try {
        await TextToSpeech.speak({
          text: pdfText[i],
          lang: 'cs-CZ',
          rate: 1.0,
          pitch: 1.0,
          volume: 1.0,
          category: 'ambient',
        });
      } catch (e) {
        console.error("TTS Error:", e);
      }
    }
    setIsReadingPdf(false);
    readingRef.current = false;
  };

  const togglePdfReading = async () => {
    if (isReadingPdf) {
      readingRef.current = false;
      setIsReadingPdf(false);
      const { TextToSpeech } = await import('@capacitor-community/text-to-speech');
      await TextToSpeech.stop();
    } else {
      if (pdfText.length === 0) return;
      readingRef.current = true;
      setIsReadingPdf(true);
      readPdfPageByPage(currentPdfPage);
    }
  };

  return (
    <main className="p-4 flex flex-col gap-6 max-w-md mx-auto w-full pt-12 pb-24 relative">
      <SettingsDialog />
      <h1 className="text-2xl font-bold text-center">Audio & PDF Player</h1>

      {/* Music Player Section */}
      <Card className="p-4 flex flex-col gap-4">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <FileAudio className="w-5 h-5" />
          <h2>Přehrávač hudby</h2>
        </div>
        
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">Vybrat MP3</label>
          <Input type="file" accept="audio/*" onChange={handleAudioUpload} />
        </div>
        
        {audioSrc && (
          <div className="flex flex-col items-center gap-4 py-4">
            <audio 
              ref={audioRef} 
              src={audioSrc} 
              onEnded={() => setIsPlayingAudio(false)} 
              loop
            />
            <Button size="icon" variant="outline" className="w-16 h-16 rounded-full" onClick={toggleAudio}>
              {isPlayingAudio ? <Pause className="w-8 h-8" /> : <Play className="w-8 h-8 ml-1" />}
            </Button>
          </div>
        )}
      </Card>

      {/* PDF Reader Section */}
      <Card className="p-4 flex flex-col gap-4">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <FileText className="w-5 h-5" />
          <h2>Čtení PDF</h2>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">Vybrat PDF dokument</label>
          <Input type="file" accept=".pdf" onChange={handlePdfUpload} />
        </div>

        {pdfText.length > 0 && (
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="text-sm text-muted-foreground text-center mb-2">
              Strana {currentPdfPage + 1} z {pdfText.length}
            </div>
            <Button size="icon" variant="outline" className="w-16 h-16 rounded-full" onClick={togglePdfReading}>
              {isReadingPdf ? <Pause className="w-8 h-8" /> : <Play className="w-8 h-8 ml-1" />}
            </Button>
          </div>
        )}
      </Card>
      
    </main>
  );
}
