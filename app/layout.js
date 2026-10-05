import "./globals.css";
import "./heatmap.css";
import "./auth.css";
import "./loaders.css";
import "./theme.css";

export const metadata = {
  title: "Aperture — Market Intelligence",
  description: "A focused view of the companies that matter to you.",
};

export default function RootLayout({ children }) {
  const themeScript = `(function(){try{var t=localStorage.getItem('aperture:theme');if(!t)t=matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light';document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t}catch(e){}})()`;
  return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeScript }}/></head><body>{children}</body></html>;
}
