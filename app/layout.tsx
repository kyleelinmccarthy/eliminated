import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Eliminated — childhood games, adult consequences",
  description:
    "A cheerful party game where adorable blobs play children's games for cash and die doing it. Red Light Green Light, the Glass Bridge, Boomerang Brawl and more. Last blob standing keeps the Marbles. Everyone else gets boxed.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0d1d1a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Bungee&family=Baloo+2:wght@500;600;700;800&family=DM+Serif+Display:ital@0;1&family=Rubik:wght@400;500;600;700;800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
