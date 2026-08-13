import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ToastProvider } from "@/components/providers/toast-provider";

export const metadata: Metadata = {
  title: "P/_ayer | Hudba offline",
  description: "Lokální hudební přehrávač s volitelnou čtečkou dokumentů.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FDFDFD" },
    { media: "(prefers-color-scheme: dark)", color: "#09090B" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

const themeScript = `try{var d=document.documentElement;var t=localStorage.getItem("microwins:theme");if(t!=="light")d.classList.add("dark");var a=localStorage.getItem("microwins:accent");if(a)d.setAttribute("data-accent",a)}catch(e){}`;

const rescueScript = `try{
if(localStorage.getItem("microwins:ota:booting")){
  setTimeout(function(){
    try{
      if(window.__mwBooted) return;
      var w=window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.WebView;
      if(!w) return;
      localStorage.removeItem("microwins:ota:booting");
      localStorage.removeItem("microwins:ota:current");
      localStorage.removeItem("microwins:ota:pending");
      w.setServerBasePath({path:""});
      w.persistServerBasePath();
      setTimeout(function(){ window.location.reload(); }, 400);
    }catch(e){}
  },10000);
}
}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="cs" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <script dangerouslySetInnerHTML={{ __html: rescueScript }} />
      </head>
      <body className="min-h-screen antialiased flex flex-col bg-background text-foreground">
        <ToastProvider>
          {children}
        </ToastProvider>
      </body>
    </html>
  );
}
